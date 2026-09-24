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

function buildRetrievalAmbiguities(
  question: string,
  evidence: Array<{ sourceId: string; itemId: number; name?: string; text?: string }>
) {
  const tokens = new Set(
    question.toLocaleLowerCase().match(/[\p{L}]{3,}/gu) ?? []
  );
  const names = new Map<string, {
    value: string;
    evidence: EvidenceReference[];
  }>();
  for (const item of evidence) {
    const phrases = item.text?.match(
      /\b[\p{Lu}][\p{Ll}]+(?:[ \t]+[\p{Lu}][\p{Ll}]+){1,3}\b/gu
    ) ?? [];
    for (const value of new Set(phrases)) {
      const parts = value.toLocaleLowerCase().split(/[ \t]+/);
      if (!parts.some(part => tokens.has(part))) continue;
      const key = value.toLocaleLowerCase();
      const entry = names.get(key) ?? { value, evidence: [] };
      if (!entry.evidence.some(ref => ref.sourceId === item.sourceId && ref.itemId === item.itemId)) {
        entry.evidence.push({ sourceId: item.sourceId, itemId: item.itemId });
      }
      names.set(key, entry);
    }
  }
  const candidates = [...names.values()].filter(item => item.evidence.length > 0);
  if (candidates.length < 2) return [];
  return [{
    classification: "RETRIEVAL_AMBIGUITY" as const,
    description:
      "A busca textual recuperou nomes distintos que compartilham um termo da pergunta. Eles permanecem separados e nenhuma identidade comum é inferida.",
    candidates
  }];
}

export function buildInvestigatorView(input: {
  question: string;
  evidence: Array<EvidenceReference & {
    name?: string;
    path?: string;
    text?: string;
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
      retrievalAmbiguities: buildRetrievalAmbiguities(input.question, input.evidence),
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


export function filterInvestigatorViewEvidence(
  view: ReturnType<typeof buildInvestigatorView>,
  allowedEvidence: EvidenceReference[]
) {
  const allowed = new Set(
    allowedEvidence.map(item => `${item.sourceId}:${item.itemId}`)
  );
  const evidence = view.sections.evidence.filter(item =>
    allowed.has(`${item.sourceId}:${item.itemId}`)
  );
  const timeline = view.sections.timeline.filter(item =>
    allowed.has(`${item.sourceId}:${item.itemId}`)
  );
  const rejectedEvidenceNodeIds = new Set(
    view.sections.relationships.nodes
      .filter(node =>
        node.kind === "EVIDENCE" &&
        !allowed.has(`${node.sourceId}:${node.itemId}`)
      )
      .map(node => node.id)
  );
  const edges = view.sections.relationships.edges.filter(edge =>
    !rejectedEvidenceNodeIds.has(edge.from) &&
    !rejectedEvidenceNodeIds.has(edge.to) &&
    edge.evidence.some(item =>
      allowed.has(`${item.sourceId}:${item.itemId}`)
    )
  ).map(edge => ({
    ...edge,
    evidence: edge.evidence.filter(item =>
      allowed.has(`${item.sourceId}:${item.itemId}`)
    )
  }));
  const connectedNodeIds = new Set(
    edges.flatMap(edge => [edge.from, edge.to])
  );
  const nodes = view.sections.relationships.nodes.filter(node =>
    node.kind === "EVIDENCE"
      ? allowed.has(`${node.sourceId}:${node.itemId}`)
      : connectedNodeIds.has(node.id)
  );
  const nodesByKind: Record<string, number> = {};
  for (const node of nodes) {
    nodesByKind[node.kind] = (nodesByKind[node.kind] ?? 0) + 1;
  }
  const edgesByRelationship: Record<string, number> = {};
  for (const edge of edges) {
    edgesByRelationship[edge.relationship] =
      (edgesByRelationship[edge.relationship] ?? 0) + 1;
  }

  return {
    ...view,
    overview: {
      ...view.overview,
      evidenceCount: evidence.length,
      relationshipCount: edges.length,
      entityCount: nodesByKind.ENTITY ?? 0,
      communicationParticipantCount:
        nodesByKind.COMMUNICATION_PARTICIPANT ?? 0,
      timelineEventCount: timeline.length
    },
    sections: {
      ...view.sections,
      evidence,
      timeline,
      relationships: {
        ...view.sections.relationships,
        summary: {
          nodeCount: nodes.length,
          edgeCount: edges.length,
          nodesByKind,
          edgesByRelationship
        },
        nodes,
        edges
      }
    }
  };
}


function buildObservedValueVariations(relationships: InvestigationGraphView) {
  const moneyNodes = relationships.nodes.filter(
    node => node.kind === "ENTITY" && node.entityType === "MONEY"
  );

  const observed = moneyNodes.map(node => {
    const evidence = new Map<string, EvidenceReference>();
    for (const edge of relationships.edges) {
      if (
        edge.relationship !== "OBSERVED_IN_EVIDENCE" ||
        (edge.from !== node.id && edge.to !== node.id)
      ) {
        continue;
      }
      for (const reference of edge.evidence) {
        evidence.set(`${reference.sourceId}:${reference.itemId}`, reference);
      }
    }
    return { value: node.label, evidence: [...evidence.values()] };
  }).filter(item => item.evidence.length > 0);

  const distinct = [...new Map(observed.map(item => [item.value, item])).values()];
  if (distinct.length < 2) return [];

  return [{
    classification: "OBSERVED_VALUE_VARIATION" as const,
    type: "MONEY",
    description: `Foram observados ${distinct.length} valores monetários distintos nas evidências recuperadas: ${distinct.map(item => item.value).join(", ")}. Valores diferentes, isoladamente, não demonstram inconsistência; a relação entre eles deve ser validada pelo contexto e pelas evidências de suporte.`,
    values: distinct
  }];
}

function buildDirectAnswer(question: string, evidence: Array<{sourceId:string;itemId:number;name?:string;path?:string;textAvailable?:boolean}>) {
  const normalized=question.toLocaleLowerCase("pt-BR");
  const asksList=/\b(liste|listar|lista|quais|mostre|mostrar)\b/.test(normalized);
  const asksFiles=/\b(arquivo|arquivos|item|itens|evidência|evidencias|evidências)\b/.test(normalized);
  const asksPath=/\b(caminho|path|localização|localizacao)\b/.test(normalized);
  const asksType=/\b(tipo|tipos|extensão|extensao|formato)\b/.test(normalized);
  if(!(asksList&&asksFiles&&(asksPath||asksType))) return undefined;
  const extension=(name?:string,path?:string)=>{
    const value=(name||path||"").split("/").pop()||"";
    const dot=value.lastIndexOf(".");
    return dot>0?value.slice(dot+1).toLocaleUpperCase("pt-BR"):"Sem extensão";
  };
  return {
    kind:"EVIDENCE_LIST" as const,
    headline:`Foram encontrados ${evidence.length} item(ns) correspondente(s) à pergunta.`,
    columns:["Item","Tipo","Caminho","Referência"],
    rows:evidence.map(item=>({
      item:item.name||`Item ${item.itemId}`,
      type:extension(item.name,item.path),
      path:item.path||"",
      reference:`${item.sourceId}:${item.itemId}`
    }))
  };
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
    evidenceSearchTruncated?: boolean;
    evidenceSearchAvailable?: number;
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
    resultState: input.resultState,
    directAnswer: buildDirectAnswer(input.question, input.view.sections.evidence),
    analysis: buildGroundedSummary({
      evidenceCount: input.view.overview.evidenceCount,
      entityCount: input.view.overview.entityCount,
      relationshipCount: input.view.overview.relationshipCount,
      communicationParticipantCount:
        input.view.overview.communicationParticipantCount,
      leads: input.view.sections.leads
    }),
    panels: {
      retrievalAmbiguities: input.view.sections.retrievalAmbiguities,
      valueVariations: buildObservedValueVariations(input.view.sections.relationships),
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
        "Foram encontradas evidências e há valores ou entidades recorrentes sustentados pelas evidências que podem ser correlacionados.",
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
