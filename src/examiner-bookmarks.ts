import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.js";
import type { AuditLog } from "./audit-log.js";

/**
 * Examiner-initiated IPED bookmark writes.
 *
 * This is the only module allowed to change state in the IPED case, and it is
 * deliberately narrow:
 *  - it only creates a bookmark label and adds/removes items from a label;
 *  - it never deletes or renames bookmarks, never changes the selection and
 *    never touches evidence content;
 *  - it is used only by the local Investigator UI in response to an explicit
 *    examiner action. It is NOT imported by the MCP server, so AI clients have
 *    no way to write bookmarks.
 *
 * IPED stores bookmarks in the processed case state, not in the original
 * evidence. Every write is recorded in the audit log.
 */

export const BOOKMARK_NAME_MAX_LENGTH = 80;

export class BookmarkInputError extends Error {}

export class BookmarkConflictError extends Error {
  constructor() {
    super(
      "Os marcadores deste caso foram alterados fora do IPED MCP (por exemplo, no IPED desktop) depois que ele foi iniciado. " +
        "Para não sobrescrever essas alterações, a marcação foi bloqueada. Feche o IPED desktop e reinicie o IPED MCP para carregar os marcadores atuais."
    );
  }
}

/**
 * IPED keeps bookmarks in memory and rewrites the whole state file
 * (<case>/iped/bookmarks.iped) on every change, without locking or reloading.
 * Two processes on the same case (IPED desktop and the Web API) therefore
 * silently overwrite each other's bookmarks.
 *
 * This guard records the state file's modification time when the
 * Investigator starts and refuses to write if the file was changed by
 * someone else since then, so the Web API never overwrites bookmarks made in
 * IPED desktop. It cannot stop IPED desktop from overwriting ours; the UI and
 * README warn the examiner about that.
 */
export class BookmarkStateGuard {
  private known?: number;
  private ownWriteAt?: number;
  private readonly ready: Promise<void>;

  constructor(
    private readonly file: string | undefined,
    private readonly ownWriteWindowMs = 15_000,
    private readonly ackTimeoutMs = 5_000
  ) {
    this.ready = this.file ? this.mtime().then(value => { this.known = value; }) : Promise.resolve();
  }

  get enabled(): boolean {
    return Boolean(this.file);
  }

  async assertUnchanged(): Promise<void> {
    if (!this.file) return;
    await this.ready;
    const current = await this.mtime();
    if (current === undefined) return;
    if (this.known === undefined || current <= this.known) {
      this.known = current;
      return;
    }
    if (
      this.ownWriteAt !== undefined &&
      current >= this.ownWriteAt - 1_000 &&
      current <= this.ownWriteAt + this.ownWriteWindowMs
    ) {
      // A late asynchronous save of our own previous write.
      this.known = current;
      return;
    }
    throw new BookmarkConflictError();
  }

  /** IPED saves asynchronously: wait briefly for our own write to reach the file. */
  async acknowledgeOwnWrite(): Promise<void> {
    if (!this.file) return;
    this.ownWriteAt = Date.now();
    const deadline = Date.now() + this.ackTimeoutMs;
    while (Date.now() < deadline) {
      const current = await this.mtime();
      if (current !== undefined && (this.known === undefined || current > this.known)) {
        this.known = current;
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }

  private async mtime(): Promise<number | undefined> {
    try {
      return (await stat(this.file!)).mtimeMs;
    } catch {
      return undefined;
    }
  }
}

export function normalizeBookmarkName(value: unknown): string {
  if (typeof value !== "string") {
    throw new BookmarkInputError("Informe o nome do marcador.");
  }
  const name = value.replace(/\s+/g, " ").trim();
  if (!name) throw new BookmarkInputError("Informe o nome do marcador.");
  if (name.length > BOOKMARK_NAME_MAX_LENGTH) {
    throw new BookmarkInputError(
      `O nome do marcador deve ter no máximo ${BOOKMARK_NAME_MAX_LENGTH} caracteres.`
    );
  }
  if (/[\u0000-\u001f\u007f/\\]/.test(name)) {
    throw new BookmarkInputError(
      "O nome do marcador não pode conter barras nem caracteres de controle."
    );
  }
  return name;
}

export class ExaminerBookmarks {
  private readonly guard: BookmarkStateGuard;

  constructor(
    private readonly config: Config,
    private readonly audit: AuditLog,
    guard?: BookmarkStateGuard
  ) {
    this.guard =
      guard ??
      new BookmarkStateGuard(
        config.ipedCaseDir ? join(config.ipedCaseDir, "iped", "bookmarks.iped") : undefined
      );
  }

  get conflictGuardEnabled(): boolean {
    return this.guard.enabled;
  }

  async list(): Promise<string[]> {
    const response = await this.send("GET", "/bookmarks");
    const body = (await response.json()) as unknown;
    const values = Array.isArray(body)
      ? body
      : Array.isArray((body as { data?: unknown })?.data)
        ? (body as { data: unknown[] }).data
        : [];
    return values.filter((value): value is string => typeof value === "string");
  }

  async mark(sourceId: string, itemId: number, rawName: unknown) {
    const bookmark = normalizeBookmarkName(rawName);
    this.validateItem(sourceId, itemId);

    await this.guardWrite(sourceId, itemId, bookmark);
    const existing = await this.list();
    const createdBookmark = !existing.includes(bookmark);
    if (createdBookmark) {
      await this.send("POST", `/bookmarks/${encodeURIComponent(bookmark)}`);
    }
    await this.send(
      "PUT",
      `/bookmarks/${encodeURIComponent(bookmark)}/add`,
      [{ source: sourceId, id: itemId }]
    );
    await this.guard.acknowledgeOwnWrite();

    await this.audit.write("examiner_bookmark_add", {
      sourceId,
      itemId,
      bookmark,
      createdBookmark
    });

    return { sourceId, itemId, bookmark, createdBookmark };
  }

  async unmark(sourceId: string, itemId: number, rawName: unknown) {
    const bookmark = normalizeBookmarkName(rawName);
    this.validateItem(sourceId, itemId);
    await this.guardWrite(sourceId, itemId, bookmark);

    await this.send(
      "PUT",
      `/bookmarks/${encodeURIComponent(bookmark)}/remove`,
      [{ source: sourceId, id: itemId }]
    );
    await this.guard.acknowledgeOwnWrite();

    await this.audit.write("examiner_bookmark_remove", {
      sourceId,
      itemId,
      bookmark
    });

    return { sourceId, itemId, bookmark };
  }

  private async guardWrite(sourceId: string, itemId: number, bookmark: string) {
    try {
      await this.guard.assertUnchanged();
    } catch (error) {
      if (error instanceof BookmarkConflictError) {
        await this.audit.write("examiner_bookmark_conflict", { sourceId, itemId, bookmark });
      }
      throw error;
    }
  }

  private validateItem(sourceId: string, itemId: number) {
    if (!sourceId || typeof sourceId !== "string") {
      throw new BookmarkInputError("Fonte da evidência inválida.");
    }
    if (!Number.isInteger(itemId) || itemId < 0) {
      throw new BookmarkInputError("Identificador da evidência inválido.");
    }
  }

  private async send(
    method: "GET" | "POST" | "PUT",
    path: string,
    payload?: unknown
  ): Promise<Response> {
    const url = new URL(path, this.config.ipedUrl);
    const response = await fetch(url, {
      method,
      headers:
        payload === undefined ? undefined : { "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(
        `IPED bookmark request failed: ${response.status} ${response.statusText}`
      );
    }
    return response;
  }
}
