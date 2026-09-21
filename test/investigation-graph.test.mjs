import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildInvestigationGraph,
  expandInvestigationGraph
} from "../dist/investigation-graph.js";

test("builds a provenance-first graph from evidence and indexed values", () => {
  const graph = buildInvestigationGraph({
    evidence: [
      { sourceId: "case-a", itemId: 10, name: "message.eml" },
      { sourceId: "case-a", itemId: 11, name: "copy.eml" }
    ],
    entities: [{
      type: "EMAIL",
      value: "person@example.test",
      evidence: [
        { sourceId: "case-a", itemId: 10 },
        { sourceId: "case-a", itemId: 11 }
      ]
    }],
    communicationParticipants: [{
      value: "+5511999999999",
      evidence: [{ sourceId: "case-a", itemId: 10 }]
    }],
    duplicateEvidence: [{
      hash: "HASH-A",
      evidence: [
        { sourceId: "case-a", itemId: 10 },
        { sourceId: "case-a", itemId: 11 }
      ]
    }]
  });

  assert.equal(graph.nodes.length, 4);
  assert.equal(
    graph.edges.filter(edge =>
      edge.relationship === "OBSERVED_IN_EVIDENCE"
    ).length,
    2
  );
  assert.equal(
    graph.edges.filter(edge =>
      edge.relationship === "OBSERVED_IN_COMMUNICATION"
    ).length,
    1
  );

  const duplicate = graph.edges.find(edge =>
    edge.relationship === "DUPLICATE_CONTENT"
  );

  assert.ok(duplicate);
  assert.equal(duplicate.hash, "HASH-A");
  assert.match(duplicate.interpretation, /not independent corroboration/);
});

test("graph edges always retain evidence references", () => {
  const graph = buildInvestigationGraph({
    evidence: [{ sourceId: "case-a", itemId: 10 }],
    entities: [{
      type: "PHONE",
      value: "+5511888888888",
      evidence: [{ sourceId: "case-a", itemId: 10 }]
    }],
    communicationParticipants: [],
    duplicateEvidence: []
  });

  assert.ok(graph.edges.length > 0);
  assert.ok(
    graph.edges.every(edge =>
      edge.evidence.length > 0 &&
      edge.evidence.every(reference =>
        reference.sourceId && Number.isInteger(reference.itemId)
      )
    )
  );
});


test("expands a graph node only through evidence-backed edges", () => {
  const graph = buildInvestigationGraph({
    evidence: [
      { sourceId: "case-a", itemId: 10, name: "message.eml" },
      { sourceId: "case-a", itemId: 11, name: "document.pdf" }
    ],
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
  });

  const expansion = expandInvestigationGraph({
    graph,
    nodeId: "entity:EMAIL:person@example.test"
  });

  assert.equal(expansion.selectedNode.kind, "ENTITY");
  assert.equal(expansion.nodes.length, 3);
  assert.equal(expansion.edges.length, 2);
  assert.ok(
    expansion.edges.every(edge =>
      edge.relationship === "OBSERVED_IN_EVIDENCE" &&
      edge.evidence.length === 1
    )
  );
});

test("rejects expansion of a node that is not present in the graph", () => {
  assert.throws(
    () => expandInvestigationGraph({
      graph: { nodes: [], edges: [] },
      nodeId: "entity:EMAIL:missing@example.test"
    }),
    /Unknown investigation graph node/
  );
});
