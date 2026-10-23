import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { InvestigationState } from "./investigation-sessions.js";
import type { Claim, ClaimInput, ClaimVerification } from "./claims.js";
import { sortEvents, type CaseEvent, type CaseEventInput } from "./case-events.js";
import type { EvidenceReference } from "./iped-client.js";

/**
 * Local persistence for Investigator sessions.
 *
 * Each investigation is saved as one JSON file containing the session state
 * (questions, queries and evidence references) and the last rendered
 * workspace, so a past investigation reopens instantly without re-running
 * the assisted AI analysis. These files are derived workspace data: they are
 * stored outside the IPED case and never written back to the evidence.
 */

export const NOTE_MAX_LENGTH = 10_000;

export interface InvestigationNote {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export class NoteInputError extends Error {}

export function normalizeNoteText(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new NoteInputError("A nota não pode ficar vazia.");
  }
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (text.length > NOTE_MAX_LENGTH) {
    throw new NoteInputError(`A nota deve ter no máximo ${NOTE_MAX_LENGTH} caracteres.`);
  }
  return text;
}

export interface StoredInvestigation {
  version: 1;
  id: string;
  sourceId?: string;
  title: string;
  questions: string[];
  createdAt: string;
  updatedAt: string;
  state: InvestigationState;
  workspace: unknown;
  notes?: InvestigationNote[];
  claims?: Claim[];
  events?: CaseEvent[];
}

export interface StoredInvestigationSummary {
  id: string;
  sourceId?: string;
  title: string;
  questionCount: number;
  createdAt: string;
  updatedAt: string;
}

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isInvestigationId(value: string): boolean {
  return ID_PATTERN.test(value);
}

export class InvestigationStore {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly directory: string) {}

  /** Serializes read-modify-write operations on the same investigation file. */
  private exclusive<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.queues.set(id, next);
    next
      .finally(() => {
        if (this.queues.get(id) === next) this.queues.delete(id);
      })
      .catch(() => undefined);
    return next;
  }

  async save(state: InvestigationState, workspace: unknown): Promise<StoredInvestigation> {
    this.file(state.id);
    return this.exclusive(state.id, async () => {
      const existing = await this.load(state.id);
      const record = this.buildRecord(state, workspace);
      record.notes = existing?.notes ?? [];
      record.claims = existing?.claims ?? [];
      record.events = existing?.events ?? [];
      await this.write(record);
      return record;
    });
  }

  async listNotes(id: string): Promise<InvestigationNote[] | undefined> {
    const record = await this.load(id);
    return record ? record.notes ?? [] : undefined;
  }

  async addNote(id: string, rawText: unknown): Promise<InvestigationNote | undefined> {
    const text = normalizeNoteText(rawText);
    if (!isInvestigationId(id)) return undefined;
    return this.exclusive(id, async () => {
      const record = await this.load(id);
      if (!record) return undefined;
      const now = new Date().toISOString();
      const note: InvestigationNote = { id: randomUUID(), text, createdAt: now, updatedAt: now };
      record.notes = [...(record.notes ?? []), note];
      await this.write(record);
      return note;
    });
  }

  async updateNote(id: string, noteId: string, rawText: unknown): Promise<InvestigationNote | undefined> {
    const text = normalizeNoteText(rawText);
    if (!isInvestigationId(id)) return undefined;
    return this.exclusive(id, async () => {
      const record = await this.load(id);
      const note = record?.notes?.find(item => item.id === noteId);
      if (!record || !note) return undefined;
      note.text = text;
      note.updatedAt = new Date().toISOString();
      await this.write(record);
      return note;
    });
  }

  async deleteNote(id: string, noteId: string): Promise<boolean> {
    if (!isInvestigationId(id)) return false;
    return this.exclusive(id, async () => {
      const record = await this.load(id);
      if (!record?.notes?.some(item => item.id === noteId)) return false;
      record.notes = record.notes.filter(item => item.id !== noteId);
      await this.write(record);
      return true;
    });
  }

  async listClaims(id: string): Promise<Claim[] | undefined> {
    const record = await this.load(id);
    return record ? record.claims ?? [] : undefined;
  }

  async getClaim(id: string, claimId: string): Promise<Claim | undefined> {
    return (await this.load(id))?.claims?.find(claim => claim.id === claimId);
  }

  async addClaim(id: string, input: ClaimInput, verification: ClaimVerification): Promise<Claim | undefined> {
    if (!isInvestigationId(id)) return undefined;
    return this.exclusive(id, async () => {
      const record = await this.load(id);
      if (!record) return undefined;
      const now = new Date().toISOString();
      const claim: Claim = { id: randomUUID(), ...input, createdAt: now, updatedAt: now, verification };
      record.claims = [...(record.claims ?? []), claim];
      await this.write(record);
      return claim;
    });
  }

  async updateClaim(
    id: string,
    claimId: string,
    input: ClaimInput | undefined,
    verification: ClaimVerification
  ): Promise<Claim | undefined> {
    if (!isInvestigationId(id)) return undefined;
    return this.exclusive(id, async () => {
      const record = await this.load(id);
      const index = record?.claims?.findIndex(claim => claim.id === claimId) ?? -1;
      if (!record?.claims || index < 0) return undefined;
      const current = record.claims[index];
      const next: Claim = input
        ? { id: current.id, ...input, createdAt: current.createdAt, updatedAt: new Date().toISOString(), verification }
        : { ...current, verification };
      record.claims[index] = next;
      await this.write(record);
      return next;
    });
  }

  async deleteClaim(id: string, claimId: string): Promise<boolean> {
    if (!isInvestigationId(id)) return false;
    return this.exclusive(id, async () => {
      const record = await this.load(id);
      if (!record?.claims?.some(claim => claim.id === claimId)) return false;
      record.claims = record.claims.filter(claim => claim.id !== claimId);
      await this.write(record);
      return true;
    });
  }

  async listEvents(id: string): Promise<CaseEvent[] | undefined> {
    const record = await this.load(id);
    return record ? sortEvents(record.events ?? []) : undefined;
  }

  async addEvent(id: string, input: CaseEventInput, missing: EvidenceReference[]): Promise<CaseEvent | undefined> {
    if (!isInvestigationId(id)) return undefined;
    return this.exclusive(id, async () => {
      const record = await this.load(id);
      if (!record) return undefined;
      const now = new Date().toISOString();
      const event: CaseEvent = { id: randomUUID(), ...input, createdAt: now, updatedAt: now, missing };
      record.events = [...(record.events ?? []), event];
      await this.write(record);
      return event;
    });
  }

  async updateEvent(id: string, eventId: string, input: CaseEventInput, missing: EvidenceReference[]): Promise<CaseEvent | undefined> {
    if (!isInvestigationId(id)) return undefined;
    return this.exclusive(id, async () => {
      const record = await this.load(id);
      const index = record?.events?.findIndex(event => event.id === eventId) ?? -1;
      if (!record?.events || index < 0) return undefined;
      const current = record.events[index];
      const next: CaseEvent = { ...current, ...input, missing, updatedAt: new Date().toISOString() };
      record.events[index] = next;
      await this.write(record);
      return next;
    });
  }

  async deleteEvent(id: string, eventId: string): Promise<boolean> {
    if (!isInvestigationId(id)) return false;
    return this.exclusive(id, async () => {
      const record = await this.load(id);
      if (!record?.events?.some(event => event.id === eventId)) return false;
      record.events = record.events.filter(event => event.id !== eventId);
      await this.write(record);
      return true;
    });
  }

  private async write(record: StoredInvestigation): Promise<void> {
    const file = this.file(record.id);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(record), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, file);
  }

  private buildRecord(state: InvestigationState, workspace: unknown): StoredInvestigation {
    const record: StoredInvestigation = {
      version: 1,
      id: state.id,
      sourceId: state.sourceId,
      title: state.question,
      questions: [state.question, ...(state.followUps ?? [])],
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      state,
      workspace
    };
    return record;
  }

  async load(id: string): Promise<StoredInvestigation | undefined> {
    if (!isInvestigationId(id)) return undefined;
    try {
      const record = JSON.parse(await readFile(this.file(id), "utf8"));
      return isStoredInvestigation(record) && record.id === id ? record : undefined;
    } catch {
      return undefined;
    }
  }

  async list(sourceId?: string): Promise<StoredInvestigationSummary[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch {
      return [];
    }
    const summaries: StoredInvestigationSummary[] = [];
    for (const name of names) {
      const id = name.replace(/\.json$/, "");
      if (!name.endsWith(".json") || !isInvestigationId(id)) continue;
      const record = await this.load(id);
      if (!record) continue;
      if (sourceId && record.sourceId && record.sourceId !== sourceId) continue;
      summaries.push({
        id: record.id,
        sourceId: record.sourceId,
        title: record.title,
        questionCount: record.questions.length,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      });
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private file(id: string): string {
    if (!isInvestigationId(id)) throw new Error("Invalid investigation id");
    return join(this.directory, `${id}.json`);
  }
}

function isStoredInvestigation(value: unknown): value is StoredInvestigation {
  const record = value as StoredInvestigation;
  return (
    !!record &&
    record.version === 1 &&
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    Array.isArray(record.questions) &&
    typeof record.updatedAt === "string" &&
    !!record.state &&
    record.state.id === record.id
  );
}
