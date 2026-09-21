import { randomUUID } from "node:crypto";
import type { EvidenceReference } from "./iped-client.js";

export interface InvestigationState {
  id: string;
  question: string;
  sourceId?: string;
  createdAt: string;
  updatedAt: string;
  evidence: EvidenceReference[];
  queries: string[];
}

export class InvestigationSessions {
  private readonly sessions = new Map<string, InvestigationState>();

  start(question: string, sourceId?: string): InvestigationState {
    const now = new Date().toISOString();
    const state: InvestigationState = {
      id: randomUUID(),
      question,
      sourceId,
      createdAt: now,
      updatedAt: now,
      evidence: [],
      queries: []
    };

    this.sessions.set(state.id, state);
    return structuredClone(state);
  }

  get(id: string): InvestigationState | undefined {
    const state = this.sessions.get(id);
    return state ? structuredClone(state) : undefined;
  }

  record(
    id: string,
    update: {
      query?: string;
      evidence?: EvidenceReference[];
    }
  ): InvestigationState {
    const state = this.sessions.get(id);

    if (!state) {
      throw new Error(`Unknown investigation session: ${id}`);
    }

    if (update.query && !state.queries.includes(update.query)) {
      state.queries.push(update.query);
    }

    for (const reference of update.evidence ?? []) {
      if (
        state.evidence.some(
          item =>
            item.sourceId === reference.sourceId &&
            item.itemId === reference.itemId
        )
      ) {
        continue;
      }

      state.evidence.push(reference);
    }

    state.updatedAt = new Date().toISOString();
    return structuredClone(state);
  }
}
