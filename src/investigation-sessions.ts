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
  expansions: number;
  lastExpansion?: {
    query: string;
    newEvidence: number;
  };
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
      queries: [],
      expansions: 0
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
      expansion?: boolean;
      expansionQuery?: string;
    }
  ): InvestigationState {
    const state = this.sessions.get(id);

    if (!state) {
      throw new Error(`Unknown investigation session: ${id}`);
    }

    if (update.query && !state.queries.includes(update.query)) {
      state.queries.push(update.query);
    }

    const evidenceCountBeforeUpdate = state.evidence.length;

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

    if (update.expansion) {
      state.expansions += 1;
      state.lastExpansion = {
        query: update.expansionQuery ?? update.query ?? "",
        newEvidence: Math.max(
          0,
          state.evidence.length - evidenceCountBeforeUpdate
        )
      };
    }

    state.updatedAt = new Date().toISOString();
    return structuredClone(state);
  }
  shouldExpand(
    id: string,
    options: {
      maxExpansions?: number;
      maxEvidence?: number;
    } = {}
  ) {
    const state = this.sessions.get(id);

    if (!state) {
      throw new Error(`Unknown investigation session: ${id}`);
    }

    const maxExpansions = options.maxExpansions ?? 6;
    const maxEvidence = options.maxEvidence ?? 100;

    if (
      state.lastExpansion &&
      state.lastExpansion.newEvidence === 0
    ) {
      return {
        expand: false,
        reason: "NO_NEW_EVIDENCE" as const,
        expansions: state.expansions,
        evidenceCount: state.evidence.length
      };
    }

    if (state.expansions >= maxExpansions) {
      return {
        expand: false,
        reason: "EXPANSION_LIMIT_REACHED" as const,
        expansions: state.expansions,
        evidenceCount: state.evidence.length
      };
    }

    if (state.evidence.length >= maxEvidence) {
      return {
        expand: false,
        reason: "EVIDENCE_LIMIT_REACHED" as const,
        expansions: state.expansions,
        evidenceCount: state.evidence.length
      };
    }

    return {
      expand: true,
      reason: "WITHIN_INVESTIGATION_LIMITS" as const,
      expansions: state.expansions,
      evidenceCount: state.evidence.length
    };
  }

}
