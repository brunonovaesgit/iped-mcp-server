import type { EvidenceReference } from "./iped-client.js";

/**
 * Examiner claims board: each conclusion is recorded with its classification
 * and the evidence for and against it, and is checked structurally against
 * IPED (read-only). The check confirms that cited items exist and detects
 * identical content (same hash) counted as independent support. It never
 * decides whether the content actually proves the statement.
 */

export type ClaimClassification = "FACT" | "INFERENCE" | "HYPOTHESIS";
export type FactBasis = "DOCUMENT_STATEMENT" | "OBSERVED_METADATA";

export const CLAIM_STATEMENT_MAX_LENGTH = 2_000;
export const CLAIM_LIMITATION_MAX_LENGTH = 2_000;
export const CLAIM_MAX_REFERENCES = 50;

export interface ClaimInput {
  classification: ClaimClassification;
  factBasis?: FactBasis;
  statement: string;
  supporting: EvidenceReference[];
  contradicting: EvidenceReference[];
  limitation?: string;
}

export interface ClaimVerification {
  checkedAt: string;
  referencesVerified: boolean;
  missing: EvidenceReference[];
  duplicateGroups: Array<{ hash: string; items: EvidenceReference[] }>;
  supportingCount: number;
  independentSupportingCount: number;
  warnings: string[];
  semanticSupportValidated: false;
}

export interface Claim extends ClaimInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  verification?: ClaimVerification;
}

export class ClaimInputError extends Error {}

const CLASSIFICATIONS = new Set(["FACT", "INFERENCE", "HYPOTHESIS"]);
const FACT_BASES = new Set(["DOCUMENT_STATEMENT", "OBSERVED_METADATA"]);

function text(value: unknown, max: number, field: string, required: boolean): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ClaimInputError(`Informe ${field}.`);
    return undefined;
  }
  if (typeof value !== "string") throw new ClaimInputError(`${field} inválido.`);
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    if (required) throw new ClaimInputError(`Informe ${field}.`);
    return undefined;
  }
  if (normalized.length > max) {
    throw new ClaimInputError(`${field} deve ter no máximo ${max} caracteres.`);
  }
  return normalized;
}

function references(value: unknown, field: string): EvidenceReference[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ClaimInputError(`${field}: lista de evidências inválida.`);
  if (value.length > CLAIM_MAX_REFERENCES) {
    throw new ClaimInputError(`${field}: no máximo ${CLAIM_MAX_REFERENCES} evidências.`);
  }
  const seen = new Set<string>();
  const result: EvidenceReference[] = [];
  for (const item of value) {
    const sourceId = (item as EvidenceReference)?.sourceId;
    const itemId = Number((item as EvidenceReference)?.itemId);
    if (typeof sourceId !== "string" || !sourceId || sourceId.length > 200 || !Number.isInteger(itemId) || itemId < 0) {
      throw new ClaimInputError(`${field}: referência de evidência inválida.`);
    }
    const key = `${sourceId}:${itemId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ sourceId, itemId });
  }
  return result;
}

export function normalizeClaimInput(input: Record<string, unknown>): ClaimInput {
  const classification = input.classification;
  if (typeof classification !== "string" || !CLASSIFICATIONS.has(classification)) {
    throw new ClaimInputError("Classifique a afirmação como fato, inferência ou hipótese.");
  }
  const statement = text(input.statement, CLAIM_STATEMENT_MAX_LENGTH, "a afirmação", true)!;
  const supporting = references(input.supporting, "Evidências a favor");
  const contradicting = references(input.contradicting, "Evidências contra");
  const limitation = text(input.limitation, CLAIM_LIMITATION_MAX_LENGTH, "a limitação", false);

  let factBasis: FactBasis | undefined;
  if (classification === "FACT") {
    if (typeof input.factBasis !== "string" || !FACT_BASES.has(input.factBasis)) {
      throw new ClaimInputError(
        "Um fato precisa indicar sua base: declaração em documento ou metadado observado."
      );
    }
    factBasis = input.factBasis as FactBasis;
    if (!supporting.length) {
      throw new ClaimInputError("Um fato precisa de pelo menos uma evidência a favor.");
    }
  }

  const supportKeys = new Set(supporting.map(ref => `${ref.sourceId}:${ref.itemId}`));
  if (contradicting.some(ref => supportKeys.has(`${ref.sourceId}:${ref.itemId}`))) {
    throw new ClaimInputError("A mesma evidência não pode estar a favor e contra a afirmação.");
  }

  return {
    classification: classification as ClaimClassification,
    ...(factBasis ? { factBasis } : {}),
    statement,
    supporting,
    contradicting,
    ...(limitation ? { limitation } : {})
  };
}

export interface EvidenceReader {
  getEvidence(sourceId: string, itemId: number): Promise<{
    sourceId: string;
    itemId: number;
    properties: Record<string, string[] | undefined>;
  }>;
}

export async function verifyClaim(reader: EvidenceReader, claim: ClaimInput): Promise<ClaimVerification> {
  const all = [...claim.supporting, ...claim.contradicting];
  const found = new Map<string, string | undefined>();
  const missing: EvidenceReference[] = [];

  await Promise.all(
    all.map(async reference => {
      const key = `${reference.sourceId}:${reference.itemId}`;
      try {
        const item = await reader.getEvidence(reference.sourceId, reference.itemId);
        found.set(key, item.properties.hash?.[0]);
      } catch {
        missing.push(reference);
      }
    })
  );

  const hashGroups = new Map<string, EvidenceReference[]>();
  for (const reference of claim.supporting) {
    const hash = found.get(`${reference.sourceId}:${reference.itemId}`);
    if (!hash) continue;
    hashGroups.set(hash, [...(hashGroups.get(hash) ?? []), reference]);
  }
  const duplicateGroups = [...hashGroups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([hash, items]) => ({ hash, items }));

  const presentSupporting = claim.supporting.filter(ref => found.has(`${ref.sourceId}:${ref.itemId}`));
  const independentSupportingCount =
    presentSupporting.length -
    duplicateGroups.reduce((total, group) => total + group.items.length - 1, 0);

  const warnings: string[] = [];
  if (missing.length) {
    warnings.push(`${missing.length} referência(s) não encontrada(s) no caso.`);
  }
  if (duplicateGroups.length) {
    warnings.push("Há evidências a favor com o mesmo conteúdo (mesmo hash); elas não contam como fontes independentes.");
  }
  if (claim.classification === "FACT" && claim.contradicting.length) {
    warnings.push("Há evidência contrária registrada para um fato; reavalie a classificação.");
  }
  if (claim.classification === "FACT" && independentSupportingCount > 1) {
    warnings.push("Se a conclusão combina vários itens e exige interpretação, classifique-a como inferência.");
  }
  if (claim.classification !== "HYPOTHESIS" && presentSupporting.length === 0) {
    warnings.push("Nenhuma evidência a favor foi confirmada no caso.");
  }

  return {
    checkedAt: new Date().toISOString(),
    referencesVerified: missing.length === 0,
    missing,
    duplicateGroups,
    supportingCount: presentSupporting.length,
    independentSupportingCount,
    warnings,
    semanticSupportValidated: false
  };
}
