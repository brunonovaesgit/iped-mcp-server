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


test("large graphs can locate nodes without removing evidence from the graph", () => {
  assert.ok(investigatorHtml.includes("data-graph-search"));
  assert.ok(investigatorHtml.includes("Localizar"));
  assert.ok(investigatorHtml.includes("Nome, valor ou tipo"));
  assert.ok(investigatorHtml.includes('haystack.includes(query)'));
  assert.ok(investigatorHtml.includes('el.style.opacity=matched?"":".12"'));
  assert.ok(!investigatorHtml.includes("graph.nodes.filter(node=>"));
});


test("graph supports direct navigation with modifier-wheel zoom and drag pan", () => {
  assert.ok(investigatorHtml.includes('graphBox.addEventListener("wheel"'));
  assert.ok(investigatorHtml.includes("event.ctrlKey||event.metaKey"));
  assert.ok(investigatorHtml.includes('graphBox.addEventListener("pointerdown"'));
  assert.ok(investigatorHtml.includes('graphBox.addEventListener("pointermove"'));
  assert.ok(investigatorHtml.includes("graphBox.scrollLeft=startLeft"));
  assert.ok(investigatorHtml.includes("graphBox.scrollTop=startTop"));
});


test("a unique graph search result is focused and centered without removing other nodes", () => {
  assert.ok(investigatorHtml.includes("const focusGraphNode=nodeId=>"));
  assert.ok(investigatorHtml.includes("if(query&&matches===1)"));
  assert.ok(investigatorHtml.includes("focusGraphNode(match.dataset.node)"));
  assert.ok(investigatorHtml.includes('behavior:"smooth"'));
  assert.ok(investigatorHtml.includes("nodeEl.dispatchEvent(new Event"));
});


test("multiple graph search matches remain selectable and focusable", () => {
  assert.ok(investigatorHtml.includes("data-graph-search-results"));
  assert.ok(investigatorHtml.includes("Escolha um dos "));
  assert.ok(investigatorHtml.includes("matchingNodes.map"));
  assert.ok(investigatorHtml.includes('graphSearchResults.addEventListener("change"'));
  assert.ok(investigatorHtml.includes("focusGraphNode(graphSearchResults.value)"));
});
