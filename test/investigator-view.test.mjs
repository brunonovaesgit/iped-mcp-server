import assert from "node:assert/strict";
import { test } from "node:test";

import { buildInvestigatorView } from "../dist/investigator-view.js";
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
