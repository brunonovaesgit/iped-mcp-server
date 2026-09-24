import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCaseSelection,
  buildInvestigationResultState,
  buildInvestigationWorkspace,
  buildInvestigatorHome,
  buildInvestigatorView,
  enrichInvestigatorView,
  filterInvestigatorViewEvidence
} from "../dist/investigator-view.js";
import {
  buildInvestigationGraph,
  buildInvestigationGraphView
} from "../dist/investigation-graph.js";

test("builds an investigator-facing view without losing evidence references", () => {
  const evidence = [{
    sourceId: "case-a",
    itemId: 10,
    name: "message.eml",
    path: "/mail/message.eml",
    textAvailable: true
  }];

  const graph = buildInvestigationGraph({
    evidence,
    entities: [{
      type: "EMAIL",
      value: "person@example.test",
      evidence: [{ sourceId: "case-a", itemId: 10 }]
    }],
    communicationParticipants: [],
    duplicateEvidence: []
  });

  const view = buildInvestigatorView({
    question: "Investigate person@example.test",
    evidence,
    graphView: buildInvestigationGraphView(graph)
  });

  assert.equal(view.question, "Investigate person@example.test");
  assert.equal(view.overview.evidenceCount, 1);
  assert.equal(view.overview.entityCount, 1);
  assert.deepEqual(
    view.sections.evidence.map(item => ({
      sourceId: item.sourceId,
      itemId: item.itemId
    })),
    [{ sourceId: "case-a", itemId: 10 }]
  );
  assert.ok(
    view.sections.evidence[0].actions.includes("OPEN_EVIDENCE")
  );
  assert.ok(
    view.actions.includes("ASK_FOLLOW_UP")
  );
});

test("investigator view exposes observed relationships, not conclusions", () => {
  const evidence = [{ sourceId: "case-a", itemId: 10 }];

  const graph = buildInvestigationGraph({
    evidence,
    entities: [{
      type: "PHONE",
      value: "+5511999999999",
      evidence
    }],
    communicationParticipants: [],
    duplicateEvidence: []
  });

  const view = buildInvestigatorView({
    question: "Investigate the phone",
    evidence,
    graphView: buildInvestigationGraphView(graph)
  });

  assert.equal(view.sections.relationships.edges.length, 1);
  assert.equal(
    view.sections.relationships.edges[0].relationship,
    "OBSERVED_IN_EVIDENCE"
  );
  assert.equal("conclusion" in view.overview, false);
  assert.equal("risk" in view.overview, false);
});


test("adds evidence-backed open leads and progress to the investigator view", () => {
  const base = buildInvestigatorView({
    question: "Investigate Carlos",
    evidence: [{ sourceId: "case-a", itemId: 10 }],
    graphView: buildInvestigationGraphView(
      buildInvestigationGraph({
        evidence: [{ sourceId: "case-a", itemId: 10 }],
        entities: [],
        communicationParticipants: [],
        duplicateEvidence: []
      })
    )
  });

  const view = enrichInvestigatorView(base, {
    leads: [{
      type: "EMAIL",
      value: "person@example.test",
      evidence: [{ sourceId: "case-a", itemId: 10 }],
      status: "OPEN"
    }],
    progress: {
      status: "CONTINUE",
      reason: "OPEN_LEAD_AVAILABLE",
      evidenceCount: 1,
      openLeadCount: 1,
      expansions: 0
    }
  });

  assert.equal(view.overview.openLeadCount, 1);
  assert.equal(view.sections.leads[0].status, "OPEN");
  assert.equal(view.sections.leads[0].action, "EXPLORE_LEAD");
  assert.deepEqual(view.sections.leads[0].evidence, [
    { sourceId: "case-a", itemId: 10 }
  ]);
  assert.equal(view.sections.progress.status, "CONTINUE");
});


test("builds a simple ready state for an investigator", () => {
  const home = buildInvestigatorHome({
    caseAvailable: true,
    sourceId: "case-a"
  });

  assert.equal(home.status, "READY");
  assert.equal(home.primaryAction, "START_INVESTIGATION");
  assert.ok(home.suggestedQuestions.length > 0);
});

test("continues an active investigation without exposing MCP operations", () => {
  const home = buildInvestigatorHome({
    caseAvailable: true,
    sourceId: "case-a",
    activeInvestigation: {
      id: "investigation-1",
      question: "Investigate Carlos Almeida",
      focus: "person@example.test",
      evidenceCount: 8,
      openLeadCount: 2,
      status: "CONTINUE"
    }
  });

  assert.equal(home.primaryAction, "CONTINUE_INVESTIGATION");
  assert.equal(home.activeInvestigation.openLeadCount, 2);
  assert.equal("tool" in home, false);
  assert.equal("sourceId" in home.activeInvestigation, false);
});

test("shows a clear unavailable state when IPED cannot be reached", () => {
  const home = buildInvestigatorHome({
    caseAvailable: false
  });

  assert.equal(home.status, "IPED_NOT_AVAILABLE");
  assert.equal(home.suggestedQuestions.length, 0);
});


test("automatically selects the only IPED source", () => {
  const selection = buildCaseSelection({
    sources: [{ id: "case-a", label: "Case A" }]
  });

  assert.equal(selection.status, "SOURCE_SELECTED");
  assert.equal(selection.selectedSourceId, "case-a");
});

test("asks for a simple source choice when multiple sources exist", () => {
  const selection = buildCaseSelection({
    sources: [
      { id: "case-a", label: "Case A" },
      { id: "case-b", label: "Case B" }
    ]
  });

  assert.equal(selection.status, "SOURCE_SELECTION_REQUIRED");
  assert.equal(selection.selectedSourceId, undefined);
  assert.equal(selection.sources.length, 2);
});

test("rejects a requested source that is not available", () => {
  const selection = buildCaseSelection({
    sources: [{ id: "case-a" }],
    requestedSourceId: "missing"
  });

  assert.equal(selection.status, "SOURCE_NOT_FOUND");
  assert.equal(selection.selectedSourceId, undefined);
});


test("guides the investigator when a search finds no evidence", () => {
  const result = buildInvestigationResultState({
    evidenceCount: 0,
    openLeadCount: 0,
    progress: {
      status: "STOP",
      reason: "NO_OPEN_LEADS"
    }
  });

  assert.equal(result.status, "NO_EVIDENCE_FOUND");
  assert.equal(result.suggestedAction, "REFINE_QUESTION");
});

test("offers evidence-backed exploration when open leads remain", () => {
  const result = buildInvestigationResultState({
    evidenceCount: 4,
    openLeadCount: 2,
    progress: {
      status: "CONTINUE",
      reason: "OPEN_LEAD_AVAILABLE"
    }
  });

  assert.equal(result.status, "READY_TO_EXPLORE");
  assert.equal(result.suggestedAction, "EXPLORE_OPEN_LEADS");
});

test("keeps found evidence reviewable when automatic expansion stops", () => {
  const result = buildInvestigationResultState({
    evidenceCount: 3,
    openLeadCount: 0,
    progress: {
      status: "STOP",
      reason: "NO_OPEN_LEADS"
    }
  });

  assert.equal(result.status, "EVIDENCE_FOUND");
  assert.equal(result.suggestedAction, "REVIEW_EVIDENCE");
});


test("builds one workspace contract for the investigator interface", () => {
  const evidence = [{
    sourceId: "case-a",
    itemId: 10,
    name: "message.eml",
    textAvailable: true
  }];
  const base = buildInvestigatorView({
    question: "Investigate Carlos",
    evidence,
    graphView: buildInvestigationGraphView(
      buildInvestigationGraph({
        evidence,
        entities: [],
        communicationParticipants: [],
        duplicateEvidence: []
      })
    )
  });
  const view = enrichInvestigatorView(base, {
    leads: [{
      type: "EMAIL",
      value: "person@example.test",
      evidence: [{ sourceId: "case-a", itemId: 10 }],
      status: "OPEN"
    }],
    progress: {
      status: "CONTINUE",
      reason: "OPEN_LEAD_AVAILABLE",
      evidenceCount: 1,
      openLeadCount: 1,
      expansions: 0
    }
  });
  const resultState = buildInvestigationResultState({
    evidenceCount: 1,
    openLeadCount: 1,
    progress: view.sections.progress
  });
  const workspace = buildInvestigationWorkspace({
    investigationId: "investigation-1",
    question: "Investigate Carlos",
    sourceId: "case-a",
    view,
    resultState
  });

  assert.equal(workspace.title, "Investigate Carlos");
  assert.equal(workspace.summary.evidenceCount, 1);
  assert.equal(workspace.panels.leads.length, 1);
  assert.equal(workspace.panels.findings.length, 1);
  assert.deepEqual(workspace.panels.findings[0], {
    classification: "OBSERVATION",
    type: "EMAIL",
    value: "person@example.test",
    evidenceCount: 1,
    evidence: [{ sourceId: "case-a", itemId: 10 }]
  });
  assert.equal(workspace.controls.question.action, "ASK_FOLLOW_UP");
  assert.equal(workspace.controls.exploreNextLead.enabled, true);
  assert.equal("tool" in workspace, false);
  assert.deepEqual(
    workspace.panels.evidence.map(item => ({
      sourceId: item.sourceId,
      itemId: item.itemId
    })),
    [{ sourceId: "case-a", itemId: 10 }]
  );
});


test("keeps the complete investigator workspace grounded and reviewable", () => {
  const evidence = [
    {
      sourceId: "case-a",
      itemId: 10,
      name: "message.eml",
      path: "/mail/message.eml",
      textAvailable: true
    },
    {
      sourceId: "case-a",
      itemId: 11,
      name: "attachment.pdf",
      path: "/mail/attachment.pdf",
      textAvailable: true
    }
  ];
  const graphView = buildInvestigationGraphView(
    buildInvestigationGraph({
      evidence,
      entities: [{
        type: "EMAIL",
        value: "person@example.test",
        evidence: [
          { sourceId: "case-a", itemId: 10 },
          { sourceId: "case-a", itemId: 11 }
        ]
      }],
      communicationParticipants: [],
      duplicateEvidence: []
    })
  );
  const base = buildInvestigatorView({
    question: "Investigue person@example.test",
    evidence,
    graphView,
    timeline: [{
      sourceId: "case-a",
      itemId: 10,
      name: "message.eml",
      event: "created",
      timestamp: "2026-01-10T12:00:00Z"
    }]
  });
  const view = enrichInvestigatorView(base, {
    leads: [{
      type: "EMAIL",
      value: "person@example.test",
      evidence: [
        { sourceId: "case-a", itemId: 10 },
        { sourceId: "case-a", itemId: 11 }
      ],
      status: "OPEN"
    }],
    progress: {
      status: "CONTINUE",
      reason: "OPEN_LEAD_AVAILABLE",
      evidenceCount: 2,
      openLeadCount: 1,
      expansions: 0
    }
  });
  const workspace = buildInvestigationWorkspace({
    investigationId: "investigation-e2e",
    question: "Investigue person@example.test",
    sourceId: "case-a",
    view,
    resultState: buildInvestigationResultState({
      evidenceCount: 2,
      openLeadCount: 1,
      progress: view.sections.progress
    })
  });

  assert.equal(workspace.status.status, "READY_TO_EXPLORE");
  assert.equal(workspace.summary.evidenceCount, 2);
  assert.equal(workspace.summary.timelineEventCount, 1);
  assert.equal(workspace.panels.findings.length, 1);
  assert.equal(workspace.panels.evidence.length, 2);
  assert.equal(workspace.panels.timeline.length, 1);
  assert.equal(workspace.panels.leads.length, 1);
  assert.ok(workspace.panels.relationships.edges.length > 0);

  for (const finding of workspace.panels.findings) {
    assert.ok(finding.evidence.length > 0);
    for (const reference of finding.evidence) {
      assert.equal(reference.sourceId, "case-a");
      assert.ok(Number.isInteger(reference.itemId));
    }
  }

  for (const edge of workspace.panels.relationships.edges) {
    assert.ok(edge.evidence.length > 0);
    for (const reference of edge.evidence) {
      assert.equal(reference.sourceId, "case-a");
      assert.ok(Number.isInteger(reference.itemId));
    }
  }

  assert.equal("conclusion" in workspace, false);
  assert.equal("guilt" in workspace, false);
});


test("surfaces distinct MONEY graph values as a neutral reviewable variation even when only one is an investigation lead", () => {
  const evidence = [
    { sourceId: "case-a", itemId: 1 },
    { sourceId: "case-a", itemId: 2 },
    { sourceId: "case-a", itemId: 3 }
  ];
  const graphView = buildInvestigationGraphView(buildInvestigationGraph({
    evidence,
    entities: [
      { type: "MONEY", value: "18.750,00", evidence: [{ sourceId: "case-a", itemId: 1 }, { sourceId: "case-a", itemId: 2 }] },
      { type: "MONEY", value: "17.850,00", evidence: [{ sourceId: "case-a", itemId: 3 }] }
    ],
    communicationParticipants: [],
    duplicateEvidence: []
  }));
  const base = buildInvestigatorView({ question: "Investigue Carlos", evidence, graphView });
  const view = enrichInvestigatorView(base, {
    leads: [
      { type: "MONEY", value: "18.750,00", evidence: [{ sourceId: "case-a", itemId: 1 }, { sourceId: "case-a", itemId: 2 }], status: "EXPLORED" }
    ],
    progress: { status: "STOP", reason: "NO_OPEN_LEADS", evidenceCount: 3, openLeadCount: 0, expansions: 1 }
  });
  const workspace = buildInvestigationWorkspace({
    investigationId: "investigation-money", question: "Investigue Carlos", sourceId: "case-a", view,
    resultState: buildInvestigationResultState({ evidenceCount: 3, openLeadCount: 0, progress: view.sections.progress })
  });
  assert.equal(workspace.panels.leads.length, 1);
  assert.equal(workspace.panels.valueVariations.length, 1);
  assert.equal(workspace.panels.valueVariations[0].classification, "OBSERVED_VALUE_VARIATION");
  assert.match(workspace.panels.valueVariations[0].description, /não demonstram inconsistência/);
  assert.deepEqual(workspace.panels.valueVariations[0].values.map(item => item.value), ["18.750,00", "17.850,00"]);
  assert.deepEqual(workspace.panels.valueVariations[0].values[1].evidence, [{ sourceId: "case-a", itemId: 3 }]);
});


test("MVP acceptance: examiner workspace remains evidence-grounded and uses neutral forensic semantics", () => {
  const evidence = [
    { sourceId: "mcp-lab", itemId: 3, name: "conversa.txt", path: "MCP Lab/conversa.txt", textAvailable: true },
    { sourceId: "mcp-lab", itemId: 8, name: "email-orion.txt", path: "MCP Lab/email-orion.txt", textAvailable: true },
    { sourceId: "mcp-lab", itemId: 2, name: "comprovante-divergente.txt", path: "MCP Lab/comprovante-divergente.txt", textAvailable: true }
  ];
  const graphView = buildInvestigationGraphView(buildInvestigationGraph({
    evidence,
    entities: [
      { type: "PROJECT", value: "Atlas", evidence: evidence.map(({ sourceId, itemId }) => ({ sourceId, itemId })) },
      { type: "MONEY", value: "18.750,00", evidence: [{ sourceId: "mcp-lab", itemId: 3 }, { sourceId: "mcp-lab", itemId: 8 }] },
      { type: "MONEY", value: "17.850,00", evidence: [{ sourceId: "mcp-lab", itemId: 2 }] }
    ],
    communicationParticipants: [],
    duplicateEvidence: []
  }));
  const base = buildInvestigatorView({ question: "Investigue Carlos Almeida", evidence, graphView });
  const view = enrichInvestigatorView(base, {
    leads: [{ type: "PROJECT", value: "Atlas", evidence: evidence.map(({ sourceId, itemId }) => ({ sourceId, itemId })), status: "OPEN" }],
    progress: { status: "CONTINUE", reason: "OPEN_LEAD_AVAILABLE", evidenceCount: 3, openLeadCount: 1, expansions: 0 }
  });
  const workspace = buildInvestigationWorkspace({
    investigationId: "mvp-acceptance",
    question: "Investigue Carlos Almeida",
    sourceId: "mcp-lab",
    view,
    resultState: buildInvestigationResultState({ evidenceCount: 3, openLeadCount: 1, progress: view.sections.progress })
  });

  assert.equal(workspace.status.status, "READY_TO_EXPLORE");
  assert.equal(workspace.panels.evidence.length, 3);
  assert.ok(workspace.panels.relationships.edges.every(edge => edge.evidence.length > 0));
  assert.equal(workspace.panels.valueVariations[0].classification, "OBSERVED_VALUE_VARIATION");
  assert.match(workspace.panels.valueVariations[0].description, /não demonstram inconsistência/);
  assert.equal("conclusion" in workspace, false);
  assert.equal("guilt" in workspace, false);
});


test("contextual view filtering removes relationships that point to rejected evidence", () => {
  const evidence = [
    { sourceId: "case-1", itemId: 1, name: "atlas.txt" },
    { sourceId: "case-1", itemId: 4, name: "apollo.txt" }
  ];
  const graphView = buildInvestigationGraphView(buildInvestigationGraph({
    evidence,
    entities: [],
    communicationParticipants: [],
    duplicateEvidence: [{
      hash: "same-hash",
      evidence: evidence.map(({ sourceId, itemId }) => ({ sourceId, itemId }))
    }]
  }));
  const view = buildInvestigatorView({
    question: "Investigue Atlas",
    evidence,
    graphView
  });
  const filtered = filterInvestigatorViewEvidence(view, [
    { sourceId: "case-1", itemId: 1 }
  ]);

  assert.deepEqual(
    filtered.sections.evidence.map(item => item.itemId),
    [1]
  );
  assert.equal(filtered.sections.relationships.edges.length, 0);
  assert.equal(
    filtered.sections.relationships.nodes.some(
      node => node.kind === "EVIDENCE" && node.itemId === 4
    ),
    false
  );
  assert.equal(filtered.sections.relationships.summary.edgeCount, 0);
});


test("examiner workspace contract does not label neutral monetary variation as inconsistency", () => {
  const evidence = [
    { sourceId: "case-a", itemId: 1 },
    { sourceId: "case-a", itemId: 2 }
  ];
  const graphView = buildInvestigationGraphView(buildInvestigationGraph({
    evidence,
    entities: [
      { type: "MONEY", value: "10,00", evidence: [{ sourceId: "case-a", itemId: 1 }] },
      { type: "MONEY", value: "20,00", evidence: [{ sourceId: "case-a", itemId: 2 }] }
    ],
    communicationParticipants: [],
    duplicateEvidence: []
  }));
  const view = buildInvestigatorView({
    question: "Analise os valores",
    evidence,
    graphView
  });
  const workspace = buildInvestigationWorkspace({
    investigationId: "terminology",
    question: "Analise os valores",
    sourceId: "case-a",
    view,
    resultState: buildInvestigationResultState({
      evidenceCount: 2,
      openLeadCount: 0,
      progress: { status: "STOP", reason: "NO_OPEN_LEADS" }
    })
  });

  assert.equal("inconsistencies" in workspace.panels, false);
  assert.equal(workspace.panels.valueVariations.length, 1);
  assert.equal(
    workspace.panels.valueVariations[0].classification,
    "OBSERVED_VALUE_VARIATION"
  );
});

test("workspace surfaces distinct names from a broad person query without merging identities", () => {
  const view = buildInvestigatorView({
    question: "Investigue todas as evidências relacionadas a Carlos",
    evidence: [
      { sourceId: "case", itemId: 1, text: "Carlos Almeida atua no Projeto Atlas" },
      { sourceId: "case", itemId: 2, text: "Mensagem de Carlos Almeida sobre Atlas" },
      { sourceId: "case", itemId: 3, text: "Carlos Santos atua no Projeto Apollo" }
    ],
    graphView: buildInvestigationGraphView(buildInvestigationGraph({
      evidence: [
        { sourceId: "case", itemId: 1 },
        { sourceId: "case", itemId: 2 },
        { sourceId: "case", itemId: 3 }
      ],
      entities: [],
      communicationParticipants: [],
      duplicateEvidence: []
    }))
  });
  const workspace = buildInvestigationWorkspace({
    investigationId: "inv",
    question: "Investigue todas as evidências relacionadas a Carlos",
    sourceId: "case",
    view,
    resultState: { status: "EVIDENCE_FOUND", message: "ok", suggestedAction: "REVIEW_EVIDENCE" }
  });
  assert.equal(workspace.panels.retrievalAmbiguities.length, 1);
  const candidates = workspace.panels.retrievalAmbiguities[0].candidates;
  assert.deepEqual(candidates.map(item => item.value).sort(), ["Carlos Almeida", "Carlos Santos"]);
  assert.deepEqual(candidates.find(item => item.value === "Carlos Santos").evidence, [
    { sourceId: "case", itemId: 3 }
  ]);
});
