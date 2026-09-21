import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCaseSelection,
  buildInvestigationResultState,
  buildInvestigatorHome,
  buildInvestigatorView,
  enrichInvestigatorView
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
