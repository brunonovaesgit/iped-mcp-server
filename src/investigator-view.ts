import type { EvidenceReference } from "./iped-client.js";
import type {
  InvestigationGraphEdge,
  InvestigationGraphNode
} from "./investigation-graph.js";

type InvestigationGraphView = {
  summary: {
    nodeCount: number;
    edgeCount: number;
    nodesByKind: Record<string, number>;
    edgesByRelationship: Record<string, number>;
  };
  nodes: Array<InvestigationGraphNode & { actions: string[] }>;
  edges: Array<InvestigationGraphEdge & { actions: string[] }>;
  legend: unknown;
};

type TimelineEvent = {
  sourceId: string;
  itemId: number;
  name?: string;
  path?: string;
  event: string;
  timestamp: string;
};

export function buildInvestigatorView(input: {
  question: string;
  evidence: Array<EvidenceReference & {
    name?: string;
    path?: string;
    textAvailable?: boolean;
  }>;
  graphView: InvestigationGraphView;
  timeline?: TimelineEvent[];
}) {
  return {
    question: input.question,
    overview: {
      evidenceCount: input.evidence.length,
      relationshipCount: input.graphView.summary.edgeCount,
      entityCount:
        input.graphView.summary.nodesByKind.ENTITY ?? 0,
      communicationParticipantCount:
        input.graphView.summary.nodesByKind.COMMUNICATION_PARTICIPANT ?? 0,
      timelineEventCount: input.timeline?.length ?? 0
    },
    sections: {
      evidence: input.evidence.map(item => ({
        sourceId: item.sourceId,
        itemId: item.itemId,
        name: item.name,
        path: item.path,
        textAvailable: item.textAvailable,
        actions: ["OPEN_EVIDENCE"]
      })),
      relationships: {
        summary: input.graphView.summary,
        nodes: input.graphView.nodes,
        edges: input.graphView.edges,
        legend: input.graphView.legend
      },
      timeline: input.timeline ?? []
    },
    actions: [
      "ASK_FOLLOW_UP",
      "FILTER_RELATIONSHIPS",
      "EXPLORE_OPEN_LEADS"
    ]
  };
}
