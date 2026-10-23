import type { EvidenceReference } from "./iped-client.js";
import type { EvidenceReader } from "./claims.js";

/**
 * Case timeline: events the examiner dates from the CONTENT of the evidence
 * (a contract signed on a given day, a meeting set in a message), as opposed
 * to file-system or metadata timestamps, which only say when a file was
 * created or modified. Each event cites the items it was read from. The
 * check confirms that those items exist in the case; it never decides
 * whether the date was read correctly.
 */

export const EVENT_DESCRIPTION_MAX_LENGTH = 1_000;
export const EVENT_MAX_REFERENCES = 20;

export interface CaseEventInput {
  /** YYYY-MM-DD or YYYY-MM-DDTHH:MM, as read in the content. No time zone is assumed. */
  date: string;
  approximate: boolean;
  description: string;
  evidence: EvidenceReference[];
}

export interface CaseEvent extends CaseEventInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  missing?: EvidenceReference[];
}

export class CaseEventInputError extends Error {}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

export function normalizeEventDate(value: unknown): string {
  if (typeof value !== "string") throw new CaseEventInputError("Informe a data do evento.");
  const match = DATE_PATTERN.exec(value.trim());
  if (!match) throw new CaseEventInputError("Data inválida. Use AAAA-MM-DD, com hora opcional.");
  const [, y, m, d, hh, mm] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || year > 2200 || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new CaseEventInputError("Data inexistente no calendário.");
  }
  if (hh !== undefined && (Number(hh) > 23 || Number(mm) > 59)) {
    throw new CaseEventInputError("Hora inválida.");
  }
  return match[0];
}

export function normalizeEventInput(input: Record<string, unknown>): CaseEventInput {
  const date = normalizeEventDate(input.date);
  if (typeof input.description !== "string" || !input.description.trim()) {
    throw new CaseEventInputError("Descreva o evento.");
  }
  const description = input.description.replace(/\r\n?/g, "\n").trim();
  if (description.length > EVENT_DESCRIPTION_MAX_LENGTH) {
    throw new CaseEventInputError(`A descrição deve ter no máximo ${EVENT_DESCRIPTION_MAX_LENGTH} caracteres.`);
  }
  const raw = input.evidence;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new CaseEventInputError("Cite pelo menos uma evidência de onde a data foi lida.");
  }
  if (raw.length > EVENT_MAX_REFERENCES) {
    throw new CaseEventInputError(`No máximo ${EVENT_MAX_REFERENCES} evidências por evento.`);
  }
  const seen = new Set<string>();
  const evidence: EvidenceReference[] = [];
  for (const item of raw) {
    const sourceId = (item as EvidenceReference)?.sourceId;
    const itemId = Number((item as EvidenceReference)?.itemId);
    if (typeof sourceId !== "string" || !sourceId || sourceId.length > 200 || !Number.isInteger(itemId) || itemId < 0) {
      throw new CaseEventInputError("Referência de evidência inválida.");
    }
    const key = `${sourceId}:${itemId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    evidence.push({ sourceId, itemId });
  }
  return { date, approximate: input.approximate === true, description, evidence };
}

/** Returns the cited items that do not exist in the case. Read-only. */
export async function missingEventEvidence(reader: EvidenceReader, event: CaseEventInput): Promise<EvidenceReference[]> {
  const missing: EvidenceReference[] = [];
  await Promise.all(event.evidence.map(async reference => {
    try { await reader.getEvidence(reference.sourceId, reference.itemId); }
    catch { missing.push(reference); }
  }));
  return missing;
}

/** Chronological order; on equal prefixes a date without time comes first. */
export function sortEvents<T extends { date: string; createdAt: string }>(events: T[]): T[] {
  return [...events].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}
