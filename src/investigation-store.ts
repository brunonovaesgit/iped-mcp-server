import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { InvestigationState } from "./investigation-sessions.js";

/**
 * Local persistence for Investigator sessions.
 *
 * Each investigation is saved as one JSON file containing the session state
 * (questions, queries and evidence references) and the last rendered
 * workspace, so a past investigation reopens instantly without re-running
 * the assisted AI analysis. These files are derived workspace data: they are
 * stored outside the IPED case and never written back to the evidence.
 */

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
  constructor(private readonly directory: string) {}

  async save(state: InvestigationState, workspace: unknown): Promise<StoredInvestigation> {
    const file = this.file(state.id);
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
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(record), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, file);
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
