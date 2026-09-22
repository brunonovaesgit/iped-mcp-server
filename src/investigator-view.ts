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


function buildObservedInconsistencies(leads: Array<{
  type: string;
  value: string;
  evidence: EvidenceReference[];
}>) {
  const money = leads.filter(lead => lead.type === "MONEY" && lead.evidence.length > 0);
  const distinct = [...new Map(money.map(lead => [lead.value, lead])).values()];
  if (distinct.length < 2) return [];
  return [{
    classification: "OBSERVED_INCONSISTENCY" as const,
    type: "MONEY",
    description: `Foram observados ${distinct.length} valores monetários distintos nas evidências recuperadas: ${distinct.map(item => item.value).join(", ")}. A divergência deve ser verificada nas evidências; o sistema não infere qual valor é correto.`,
    values: distinct.map(item => ({ value: item.value, evidence: item.evidence }))
  }];
}

function buildGroundedSummary(input: {
  evidenceCount: number;
  entityCount: number;
  relationshipCount: number;
  communicationParticipantCount: number;
  leads: Array<{
    type: string;
    value: string;
    evidence: EvidenceReference[];
    status: "OPEN" | "EXPLORED";
  }>;
}) {
  if (input.evidenceCount === 0) {
    return {
      headline: "Nenhuma evidência correspondente foi encontrada.",
      observations: [],
      limitation:
        "A ausência de resultados nesta busca não demonstra que o fato investigado não ocorreu."
    };
  }

  const observations = input.leads
    .filter(lead => lead.evidence.length > 0)
    .slice(0, 5)
    .map(lead => ({
      text:
        lead.type === "MONEY"
          ? `O valor ${lead.value} foi observado em ${lead.evidence.length} evidência(s) recuperada(s).`
          : `${lead.value} (${lead.type}) foi observado em ${lead.evidence.length} evidência(s) recuperada(s).`,
      evidence: lead.evidence
    }));

  return {
    headline:
      `A busca recuperou ${input.evidenceCount} evidência(s), ` +
      `${input.entityCount} entidade(s) indexada(s) e ` +
      `${input.relationshipCount} relação(ões) observada(s).`,
    observations,
    communication:
      input.communicationParticipantCount > 0
        ? `${input.communicationParticipantCount} participante(s) de comunicação foram observados nos resultados.`
        : "Nenhum participante de comunicação recorrente foi identificado nesta busca.",
    limitation:
      "Estes são achados observados nos dados recuperados. Relações, autoria, intenção e relevância jurídica exigem validação do perito e não são inferidas automaticamente."
  };
}

export function buildInvestigationWorkspace(input: {
  investigationId: string;
  question: string;
  focus?: string;
  sourceId?: string;
  view: ReturnType<typeof buildInvestigatorView>;
  resultState: {
    status: string;
    message: string;
    suggestedAction: string;
  };
}) {
  return {
    investigationId: input.investigationId,
    title: input.question,
    focus: input.focus,
    case: {
      sourceId: input.sourceId
    },
    summary: input.view.overview,
    status: input.resultState,
    analysis: buildGroundedSummary({
      evidenceCount: input.view.overview.evidenceCount,
      entityCount: input.view.overview.entityCount,
      relationshipCount: input.view.overview.relationshipCount,
      communicationParticipantCount:
        input.view.overview.communicationParticipantCount,
      leads: input.view.sections.leads
    }),
    panels: {
      inconsistencies: buildObservedInconsistencies(input.view.sections.leads),
      findings: input.view.sections.leads
        .filter(lead => lead.evidence.length > 0)
        .map(lead => ({
          classification: "OBSERVATION" as const,
          type: lead.type,
          value: lead.value,
          evidenceCount: lead.evidence.length,
          evidence: lead.evidence
        })),
      evidence: input.view.sections.evidence,
      relationships: input.view.sections.relationships,
      timeline: input.view.sections.timeline,
      leads: input.view.sections.leads
    },
    controls: {
      question: {
        placeholder: "Pergunte algo sobre esta investigação.",
        action: "ASK_FOLLOW_UP"
      },
      exploreNextLead:
        input.view.sections.progress?.status === "CONTINUE"
          ? {
              enabled: true,
              action: "EXPLORE_NEXT_LEAD"
            }
          : {
              enabled: false,
              action: "EXPLORE_NEXT_LEAD"
            }
    }
  };
}

export function buildInvestigationResultState(input: {
  evidenceCount: number;
  openLeadCount: number;
  progress: {
    status: "CONTINUE" | "STOP";
    reason: string;
  };
}) {
  if (input.evidenceCount === 0) {
    return {
      status: "NO_EVIDENCE_FOUND" as const,
      message:
        "Nenhuma evidência correspondente foi encontrada nesta busca.",
      suggestedAction: "REFINE_QUESTION" as const
    };
  }

  if (input.progress.status === "CONTINUE") {
    return {
      status: "READY_TO_EXPLORE" as const,
      message:
        "Foram encontradas evidências e há pistas sustentadas para aprofundamento.",
      suggestedAction: "EXPLORE_OPEN_LEADS" as const
    };
  }

  return {
    status: "EVIDENCE_FOUND" as const,
    message:
      "Foram encontradas evidências, mas não há expansão automática recomendada.",
    suggestedAction: "REVIEW_EVIDENCE" as const
  };
}

export function buildCaseSelection(input: {
  sources: Array<{ id: string; label?: string }>;
  requestedSourceId?: string;
}) {
  if (input.requestedSourceId) {
    const selected = input.sources.find(
      source => source.id === input.requestedSourceId
    );

    if (!selected) {
      return {
        status: "SOURCE_NOT_FOUND" as const,
        selectedSourceId: undefined,
        sources: input.sources
      };
    }

    return {
      status: "SOURCE_SELECTED" as const,
      selectedSourceId: selected.id,
      sources: input.sources
    };
  }

  if (input.sources.length === 1) {
    return {
      status: "SOURCE_SELECTED" as const,
      selectedSourceId: input.sources[0].id,
      sources: input.sources
    };
  }

  return {
    status:
      input.sources.length > 1
        ? "SOURCE_SELECTION_REQUIRED" as const
        : "NO_SOURCES" as const,
    selectedSourceId: undefined,
    sources: input.sources
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
    questionInput: input.caseAvailable
      ? {
          placeholder:
            "O que você quer investigar neste caso?",
          action: "START_INVESTIGATION"
        }
      : undefined,
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
