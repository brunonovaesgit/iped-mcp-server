import type { EvidenceReference } from "./iped-client.js";

type InvestigationEvidence = EvidenceReference & {
  name?: string;
  path?: string;
};

type IndexedEntity = {
  type: string;
  value: string;
  evidence: EvidenceReference[];
};

type CommunicationParticipant = {
  value: string;
  evidence: EvidenceReference[];
};

type DuplicateEvidence = {
  hash: string;
  evidence: EvidenceReference[];
};

export type InvestigationGraphNode =
  | {
      id: string;
      kind: "EVIDENCE";
      label: string;
      sourceId: string;
      itemId: number;
      path?: string;
    }
  | {
      id: string;
      kind: "ENTITY" | "COMMUNICATION_PARTICIPANT";
      label: string;
      entityType?: string;
    };

export type InvestigationGraphEdge = {
  id: string;
  from: string;
  to: string;
  relationship:
    | "OBSERVED_IN_EVIDENCE"
    | "OBSERVED_IN_COMMUNICATION"
    | "DUPLICATE_CONTENT";
  evidence: EvidenceReference[];
  value?: string;
  hash?: string;
  interpretation: string;
};

export function buildInvestigationGraph(input: {
  evidence: InvestigationEvidence[];
  entities: IndexedEntity[];
  communicationParticipants: CommunicationParticipant[];
  duplicateEvidence: DuplicateEvidence[];
}) {
  const nodes = new Map<string, InvestigationGraphNode>();
  const edges = new Map<string, InvestigationGraphEdge>();

  const evidenceId = (reference: EvidenceReference) =>
    `evidence:${reference.sourceId}:${reference.itemId}`;

  for (const item of input.evidence) {
    nodes.set(evidenceId(item), {
      id: evidenceId(item),
      kind: "EVIDENCE",
      label: item.name ?? `${item.sourceId}:${item.itemId}`,
      sourceId: item.sourceId,
      itemId: item.itemId,
      ...(item.path ? { path: item.path } : {})
    });
  }

  for (const entity of input.entities) {
    const nodeId = `entity:${entity.type}:${entity.value}`;
    nodes.set(nodeId, {
      id: nodeId,
      kind: "ENTITY",
      label: entity.value,
      entityType: entity.type
    });

    for (const reference of entity.evidence) {
      const edgeId = `${nodeId}->${evidenceId(reference)}`;
      edges.set(edgeId, {
        id: edgeId,
        from: nodeId,
        to: evidenceId(reference),
        relationship: "OBSERVED_IN_EVIDENCE",
        evidence: [reference],
        value: entity.value,
        interpretation:
          "This indexed value was observed in the referenced evidence. It does not by itself establish real-world identity or relationship."
      });
    }
  }

  for (const participant of input.communicationParticipants) {
    const nodeId = `communication:${participant.value}`;
    nodes.set(nodeId, {
      id: nodeId,
      kind: "COMMUNICATION_PARTICIPANT",
      label: participant.value
    });

    for (const reference of participant.evidence) {
      const edgeId = `${nodeId}->${evidenceId(reference)}`;
      edges.set(edgeId, {
        id: edgeId,
        from: nodeId,
        to: evidenceId(reference),
        relationship: "OBSERVED_IN_COMMUNICATION",
        evidence: [reference],
        value: participant.value,
        interpretation:
          "This participant value was observed in IPED communication metadata for the referenced evidence. It does not by itself establish real-world identity."
      });
    }
  }

  for (const duplicate of input.duplicateEvidence) {
    for (let left = 0; left < duplicate.evidence.length; left += 1) {
      for (
        let right = left + 1;
        right < duplicate.evidence.length;
        right += 1
      ) {
        const from = evidenceId(duplicate.evidence[left]);
        const to = evidenceId(duplicate.evidence[right]);
        const edgeId = `duplicate:${duplicate.hash}:${from}:${to}`;

        edges.set(edgeId, {
          id: edgeId,
          from,
          to,
          relationship: "DUPLICATE_CONTENT",
          evidence: [
            duplicate.evidence[left],
            duplicate.evidence[right]
          ],
          hash: duplicate.hash,
          interpretation:
            "These evidence items share the same hash and are duplicate content, not independent corroboration."
        });
      }
    }
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()]
  };
}
