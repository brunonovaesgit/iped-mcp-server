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

export function getInvestigationGraphEvidence(
  graph: {
    nodes: InvestigationGraphNode[];
    edges: InvestigationGraphEdge[];
  },
  nodeId: string
) {
  const node = graph.nodes.find(item => item.id === nodeId);

  if (!node) {
    throw new Error(`Unknown investigation graph node: ${nodeId}`);
  }

  if (node.kind === "EVIDENCE") {
    return {
      selectedNode: node,
      evidence: [{
        sourceId: node.sourceId,
        itemId: node.itemId
      }]
    };
  }

  const evidence = new Map<string, EvidenceReference>();

  for (const edge of graph.edges) {
    if (edge.from !== node.id && edge.to !== node.id) {
      continue;
    }

    for (const reference of edge.evidence) {
      evidence.set(
        `${reference.sourceId}:${reference.itemId}`,
        reference
      );
    }
  }

  return {
    selectedNode: node,
    evidence: [...evidence.values()]
  };
}

export function describeInvestigationGraphEdge(
  graph: {
    nodes: InvestigationGraphNode[];
    edges: InvestigationGraphEdge[];
  },
  edgeId: string
) {
  const edge = graph.edges.find(item => item.id === edgeId);

  if (!edge) {
    throw new Error(`Unknown investigation graph edge: ${edgeId}`);
  }

  const from = graph.nodes.find(node => node.id === edge.from);
  const to = graph.nodes.find(node => node.id === edge.to);

  if (!from || !to) {
    throw new Error(
      `Investigation graph edge ${edgeId} references a missing node`
    );
  }

  return {
    edge,
    from,
    to,
    provenance: edge.evidence,
    interpretation: edge.interpretation
  };
}

export function summarizeInvestigationGraph(graph: {
  nodes: InvestigationGraphNode[];
  edges: InvestigationGraphEdge[];
}) {
  const nodesByKind = graph.nodes.reduce<Record<string, number>>(
    (counts, node) => {
      counts[node.kind] = (counts[node.kind] ?? 0) + 1;
      return counts;
    },
    {}
  );

  const edgesByRelationship = graph.edges.reduce<Record<string, number>>(
    (counts, edge) => {
      counts[edge.relationship] =
        (counts[edge.relationship] ?? 0) + 1;
      return counts;
    },
    {}
  );

  const degree = new Map<string, number>();

  for (const edge of graph.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }

  const connectedNodes = graph.nodes
    .map(node => ({
      id: node.id,
      kind: node.kind,
      label: node.label,
      connections: degree.get(node.id) ?? 0
    }))
    .filter(node => node.connections > 0)
    .sort((left, right) =>
      right.connections - left.connections ||
      left.label.localeCompare(right.label)
    );

  return {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    nodesByKind,
    edgesByRelationship,
    connectedNodes
  };
}

export function filterInvestigationGraph(input: {
  graph: {
    nodes: InvestigationGraphNode[];
    edges: InvestigationGraphEdge[];
  };
  kinds?: InvestigationGraphNode["kind"][];
  relationships?: InvestigationGraphEdge["relationship"][];
}) {
  const allowedKinds = input.kinds
    ? new Set(input.kinds)
    : undefined;
  const allowedRelationships = input.relationships
    ? new Set(input.relationships)
    : undefined;

  const nodes = allowedKinds
    ? input.graph.nodes.filter(node => allowedKinds.has(node.kind))
    : input.graph.nodes;

  const nodeIds = new Set(nodes.map(node => node.id));
  const edges = input.graph.edges.filter(edge =>
    nodeIds.has(edge.from) &&
    nodeIds.has(edge.to) &&
    (!allowedRelationships ||
      allowedRelationships.has(edge.relationship))
  );

  const connectedNodeIds = new Set<string>();

  for (const edge of edges) {
    connectedNodeIds.add(edge.from);
    connectedNodeIds.add(edge.to);
  }

  return {
    nodes: nodes.filter(node =>
      connectedNodeIds.has(node.id) ||
      (!allowedRelationships && edges.length === 0)
    ),
    edges
  };
}

export function expandInvestigationGraph(input: {
  graph: {
    nodes: InvestigationGraphNode[];
    edges: InvestigationGraphEdge[];
  };
  nodeId: string;
}) {
  const node = input.graph.nodes.find(item => item.id === input.nodeId);

  if (!node) {
    throw new Error(`Unknown investigation graph node: ${input.nodeId}`);
  }

  const edges = input.graph.edges.filter(
    edge => edge.from === node.id || edge.to === node.id
  );

  const connectedNodeIds = new Set<string>([node.id]);

  for (const edge of edges) {
    connectedNodeIds.add(edge.from);
    connectedNodeIds.add(edge.to);
  }

  return {
    selectedNode: node,
    nodes: input.graph.nodes.filter(item =>
      connectedNodeIds.has(item.id)
    ),
    edges
  };
}

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
