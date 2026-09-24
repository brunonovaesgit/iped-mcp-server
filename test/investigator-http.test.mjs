import assert from "node:assert/strict";
import { test } from "node:test";
import { investigatorHtml } from "../dist/investigator-http.js";

test("relationship graph exposes adaptive layout and navigation controls", () => {
  for (const label of ["Radial", "Grade", "Ampla", "Evidências × entidades", "Tela cheia"]) {
    assert.ok(investigatorHtml.includes(label));
  }
  assert.ok(investigatorHtml.includes('data-graph-action="plus"'));
  assert.ok(investigatorHtml.includes('data-graph-action="minus"'));
  assert.ok(investigatorHtml.includes('data-graph-action="reset"'));
  assert.ok(investigatorHtml.includes("Math.max(900,nodeCount*58)"));
  assert.ok(investigatorHtml.includes("Math.max(1000,useCols*cellW)"));
});

test("relationship graph renders the complete node collection without a UI cap", () => {
  assert.equal(investigatorHtml.includes("graph.nodes.slice("), false);
  assert.ok(investigatorHtml.includes("graph.nodes.map("));
});


test("timeline keeps provenance visible and navigates to the exact evidence item", () => {
  assert.ok(investigatorHtml.includes("timelineEvidenceButton"));
  assert.ok(investigatorHtml.includes("Abrir evidência"));
  assert.ok(investigatorHtml.includes("t.path"));
  assert.ok(investigatorHtml.includes("t.sourceId"));
  assert.ok(investigatorHtml.includes("t.itemId"));
  assert.ok(investigatorHtml.includes("openEvidence(button.dataset.source,button.dataset.item)"));
});


test("graph nodes and relationships expose supporting IPED evidence navigation", () => {
  assert.ok(investigatorHtml.includes("graphEvidenceButton"));
  assert.ok(investigatorHtml.includes("Abrir '+escapeHtml(e.sourceId)+':'+escapeHtml(e.itemId)"));
  assert.ok(investigatorHtml.includes("e.sourceId"));
  assert.ok(investigatorHtml.includes("e.itemId"));
  const navigationHook = 'openEvidence(button.dataset.source,button.dataset.item)';
  assert.ok(investigatorHtml.split(navigationHook).length >= 3);
});
