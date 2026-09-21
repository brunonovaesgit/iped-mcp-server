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
  leads?: Array<{
    type: string;
    value: string;
    evidence: EvidenceReference[];
    status: "OPEN" | "EXPLORED";
  }>;
  progress?: {
    status: "CONTINUE" | "STOP";
    reason: string;
    evidenceCount: number;
    openLeadCount: number;
    expansions: number;
    nextLead?: {
      type: string;
      value: string;
      evidence: EvidenceReference[];
      status: "OPEN" | "EXPLORED";
    };
  };
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
      timelineEventCount: input.timeline?.length ?? 0,
      openLeadCount:
        input.leads?.filter(lead => lead.status === "OPEN").length ?? 0
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
      timeline: input.timeline ?? [],
      leads: (input.leads ?? []).map(lead => ({
        ...lead,
        action: lead.status === "OPEN" ? "EXPLORE_LEAD" : undefined
      })),
      progress: input.progress
    },
    actions: [
      "ASK_FOLLOW_UP",
      "FILTER_RELATIONSHIPS",
      "EXPLORE_OPEN_LEADS"
    ]
  };
}


export function buildInvestigatorHome(input: {
  caseAvailable: boolean;
  sourceId?: string;
  activeInvestigation?: {
    id: string;
    question: string;
    focus?: string;
    evidenceCount: number;
    openLeadCount: number;
    status: "CONTINUE" | "STOP";
  };
}) {
  return {
    status: input.caseAvailable ? "READY" : "IPED_NOT_AVAILABLE",
    sourceId: input.sourceId,
    activeInvestigation: input.activeInvestigation,
    primaryAction: input.activeInvestigation
      ? "CONTINUE_INVESTIGATION"
      : "START_INVESTIGATION",
    suggestedQuestions: input.caseAvailable
      ? [
          "Investigue uma pessoa, empresa, telefone, e-mail ou outro identificador.",
          "Procure relações entre pessoas, comunicações e evidências.",
          "Analise evidências relacionadas a um fato ou hipótese investigativa."
        ]
      : []
  };
}

export function enrichInvestigatorView(
  view: ReturnType<typeof buildInvestigatorView>,
  input: {
    leads: Array<{
      type: string;
      value: string;
      evidence: EvidenceReference[];
      status: "OPEN" | "EXPLORED";
    }>;
    progress: {
      status: "CONTINUE" | "STOP";
      reason: string;
      evidenceCount: number;
      openLeadCount: number;
      expansions: number;
      nextLead?: {
        type: string;
        value: string;
        evidence: EvidenceReference[];
        status: "OPEN" | "EXPLORED";
      };
    };
  }
) {
  return {
    ...view,
    overview: {
      ...view.overview,
      openLeadCount:
        input.leads.filter(lead => lead.status === "OPEN").length
    },
    sections: {
      ...view.sections,
      leads: input.leads.map(lead => ({
        ...lead,
        action: lead.status === "OPEN" ? "EXPLORE_LEAD" : undefined
      })),
      progress: input.progress
    }
  };
}
