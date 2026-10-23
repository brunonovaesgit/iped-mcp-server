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
  constructor(
    private readonly config: Config,
    private readonly audit: AuditLog
  ) {}

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

    await this.send(
      "PUT",
      `/bookmarks/${encodeURIComponent(bookmark)}/remove`,
      [{ source: sourceId, id: itemId }]
    );

    await this.audit.write("examiner_bookmark_remove", {
      sourceId,
      itemId,
      bookmark
    });

    return { sourceId, itemId, bookmark };
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
