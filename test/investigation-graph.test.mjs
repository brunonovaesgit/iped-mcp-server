import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildInvestigationGraph,
  buildInvestigationGraphView,
  describeInvestigationGraphEdge,
  expandInvestigationGraph,
  filterInvestigationGraph,
  getInvestigationGraphEvidence,
  summarizeInvestigationGraph
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


test("filters graph views without losing edge provenance", () => {
  const graph = buildInvestigationGraph({
    evidence: [
      { sourceId: "case-a", itemId: 10, name: "message.eml" },
      { sourceId: "case-a", itemId: 11, name: "copy.eml" }
    ],
    entities: [{
      type: "EMAIL",
      value: "person@example.test",
      evidence: [{ sourceId: "case-a", itemId: 10 }]
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

  const duplicateView = filterInvestigationGraph({
    graph,
    relationships: ["DUPLICATE_CONTENT"]
  });

  assert.equal(duplicateView.edges.length, 1);
  assert.equal(duplicateView.edges[0].relationship, "DUPLICATE_CONTENT");
  assert.equal(duplicateView.edges[0].evidence.length, 2);

  const communicationView = filterInvestigationGraph({
    graph,
    kinds: ["EVIDENCE", "COMMUNICATION_PARTICIPANT"],
    relationships: ["OBSERVED_IN_COMMUNICATION"]
  });

  assert.equal(communicationView.edges.length, 1);
  assert.ok(
    communicationView.nodes.some(node =>
      node.kind === "COMMUNICATION_PARTICIPANT"
    )
  );
  assert.ok(
    communicationView.edges.every(edge => edge.evidence.length > 0)
  );
});


test("summarizes graph structure without inferring importance", () => {
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
    communicationParticipants: [{
      value: "+5511999999999",
      evidence: [{ sourceId: "case-a", itemId: 10 }]
    }],
    duplicateEvidence: []
  });

  const summary = summarizeInvestigationGraph(graph);

  assert.equal(summary.nodeCount, 4);
  assert.equal(summary.edgeCount, 3);
  assert.deepEqual(summary.nodesByKind, {
    EVIDENCE: 2,
    ENTITY: 1,
    COMMUNICATION_PARTICIPANT: 1
  });
  assert.equal(summary.edgesByRelationship.OBSERVED_IN_EVIDENCE, 2);
  assert.equal(summary.edgesByRelationship.OBSERVED_IN_COMMUNICATION, 1);
  assert.equal(summary.connectedNodes[0].connections, 2);
  assert.equal("importance" in summary.connectedNodes[0], false);
  assert.equal("risk" in summary.connectedNodes[0], false);
});


test("explains a graph relationship with its exact forensic provenance", () => {
  const graph = buildInvestigationGraph({
    evidence: [{ sourceId: "case-a", itemId: 10, name: "message.eml" }],
    entities: [{
      type: "EMAIL",
      value: "person@example.test",
      evidence: [{ sourceId: "case-a", itemId: 10 }]
    }],
    communicationParticipants: [],
    duplicateEvidence: []
  });

  const edge = graph.edges[0];
  const explanation = describeInvestigationGraphEdge(graph, edge.id);

  assert.equal(explanation.edge.relationship, "OBSERVED_IN_EVIDENCE");
  assert.equal(explanation.from.kind, "ENTITY");
  assert.equal(explanation.to.kind, "EVIDENCE");
  assert.deepEqual(explanation.provenance, [
    { sourceId: "case-a", itemId: 10 }
  ]);
  assert.match(explanation.interpretation, /does not by itself establish/);
});

test("rejects explanation for an unknown graph relationship", () => {
  assert.throws(
    () => describeInvestigationGraphEdge(
      { nodes: [], edges: [] },
      "missing-edge"
    ),
    /Unknown investigation graph edge/
  );
});


test("resolves entity graph nodes back to supporting evidence", () => {
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

  const result = getInvestigationGraphEvidence(
    graph,
    "entity:EMAIL:person@example.test"
  );

  assert.equal(result.selectedNode.kind, "ENTITY");
  assert.deepEqual(result.evidence, [
    { sourceId: "case-a", itemId: 10 },
    { sourceId: "case-a", itemId: 11 }
  ]);
});

test("resolves an evidence graph node directly to its IPED reference", () => {
  const graph = buildInvestigationGraph({
    evidence: [{ sourceId: "case-a", itemId: 10, name: "message.eml" }],
    entities: [],
    communicationParticipants: [],
    duplicateEvidence: []
  });

  const result = getInvestigationGraphEvidence(
    graph,
    "evidence:case-a:10"
  );

  assert.deepEqual(result.evidence, [
    { sourceId: "case-a", itemId: 10 }
  ]);
});


test("builds a UI-ready graph view without adding inferred relationships", () => {
  const graph = buildInvestigationGraph({
    evidence: [{ sourceId: "case-a", itemId: 10, name: "message.eml" }],
    entities: [{
      type: "EMAIL",
      value: "person@example.test",
      evidence: [{ sourceId: "case-a", itemId: 10 }]
    }],
    communicationParticipants: [],
    duplicateEvidence: []
  });

  const view = buildInvestigationGraphView(graph);

  assert.equal(view.summary.nodeCount, graph.nodes.length);
  assert.equal(view.summary.edgeCount, graph.edges.length);
  assert.equal(view.edges.length, graph.edges.length);
  assert.deepEqual(
    view.edges.map(edge => ({
      id: edge.id,
      relationship: edge.relationship,
      evidence: edge.evidence
    })),
    graph.edges.map(edge => ({
      id: edge.id,
      relationship: edge.relationship,
      evidence: edge.evidence
    }))
  );
  assert.ok(
    view.nodes.every(node =>
      node.actions.includes("SHOW_SUPPORTING_EVIDENCE")
    )
  );
  assert.ok(
    view.edges.every(edge =>
      edge.actions.includes("EXPLAIN_RELATIONSHIP")
    )
  );
});
