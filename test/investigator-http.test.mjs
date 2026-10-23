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

test("relationship graph chooses its automatic layout from relationship density, not only node count", () => {
  assert.ok(investigatorHtml.includes("const relationshipDensity=nodeCount?edgeCount/nodeCount:0;"));
  assert.ok(
    investigatorHtml.includes(
      'const automatic=edgeCount>=8&&relationshipDensity>=2.5?"hierarchical":nodeCount<=18?"radial":nodeCount<=60?"grid":"wide";'
    )
  );
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


test("Enter cycles through multiple graph search matches", () => {
  assert.ok(investigatorHtml.includes('graphSearch.addEventListener("keydown"'));
  assert.ok(investigatorHtml.includes('event.key!=="Enter"'));
  assert.ok(investigatorHtml.includes("(current+1)%options.length"));
  assert.ok(investigatorHtml.includes("focusGraphNode(next.value)"));
});


test("Escape clears graph search and restores the complete network view", () => {
  assert.ok(investigatorHtml.includes('event.key==="Escape"'));
  assert.ok(investigatorHtml.includes('graphSearch.value=""'));
  assert.ok(investigatorHtml.includes('graphSearch.dispatchEvent(new Event("input"))'));
  assert.ok(investigatorHtml.includes('el.style.opacity=""'));
  assert.ok(investigatorHtml.includes('detail.innerHTML=""'));
});


test("graph exposes its keyboard and zoom navigation shortcuts to investigators", () => {
  assert.ok(investigatorHtml.includes("Enter: próximo"));
  assert.ok(investigatorHtml.includes("Esc: limpar"));
  assert.ok(investigatorHtml.includes("Ctrl/Cmd + roda: zoom"));
  assert.ok(investigatorHtml.includes("data-graph-search-hint"));
});


test("graph keeps a complete clickable minimap for orientation on large canvases", () => {
  assert.ok(investigatorHtml.includes("graphMiniMap"));
  assert.ok(investigatorHtml.includes("Visão geral da rede"));
  assert.ok(investigatorHtml.includes('miniMap.addEventListener("click"'));
  assert.ok(investigatorHtml.includes("ratioX*graphBox.scrollWidth"));
  assert.ok(investigatorHtml.includes("graph.nodes.map(node=>"));
});


test("graph minimap shows and updates the current viewport", () => {
  assert.ok(investigatorHtml.includes("miniViewport"));
  assert.ok(investigatorHtml.includes("const updateMiniViewport"));
  assert.ok(investigatorHtml.includes('graphBox.addEventListener("scroll",updateMiniViewport'));
  assert.ok(investigatorHtml.includes("graphBox.scrollLeft/fullW*width"));
  assert.ok(investigatorHtml.includes("graphBox.clientWidth/fullW*width"));
});


test("graph can fit the complete network into the available viewport", () => {
  assert.ok(investigatorHtml.includes('data-graph-action="fit"'));
  assert.ok(investigatorHtml.includes(">Ajustar</button>"));
  assert.ok(investigatorHtml.includes("availableW/width"));
  assert.ok(investigatorHtml.includes("availableH/height"));
  assert.ok(investigatorHtml.includes("Math.max(.05,Math.min(1"));
});


test("fit-to-view is not constrained by the interactive zoom floor on very large graphs", () => {
  assert.ok(investigatorHtml.includes("Math.max(.05,Math.min(1"));
  assert.ok(investigatorHtml.includes('scale=Math.max(.35,scale-.2)'));
});


test("direct evidence-list answers navigate back to the exact IPED evidence", () => {
  assert.ok(investigatorHtml.includes("directEvidenceButton"));
  assert.ok(investigatorHtml.includes(">Abrir evidência</button>"));
  assert.ok(investigatorHtml.includes(`data-source="'+escapeHtml(r.sourceId)`));
  assert.ok(investigatorHtml.includes(`data-item="'+escapeHtml(r.itemId)`));
  assert.ok(investigatorHtml.includes("openEvidence(button.dataset.source,button.dataset.item)"));
});


test("graph zoom resizes the SVG canvas so enlarged networks remain scrollable instead of clipped", () => {
  assert.ok(investigatorHtml.includes('const graphSvg=viewport.closest("svg")'));
  assert.ok(investigatorHtml.includes('graphSvg.setAttribute("width",String(Math.max(1,width*scale)))'));
  assert.ok(investigatorHtml.includes('graphSvg.setAttribute("height",String(Math.max(1,height*scale)))'));
  assert.ok(investigatorHtml.includes('graphSvg.setAttribute("viewBox","0 0 "+width+" "+height)'));
  assert.ok(investigatorHtml.includes("viewport.removeAttribute"));
  assert.equal(investigatorHtml.includes('viewport.setAttribute("transform","scale("+scale+")")'), false);
});


test("observed findings expose their supporting IPED evidence as navigable references", () => {
  assert.ok(investigatorHtml.includes("findingEvidenceButton"));
  assert.ok(investigatorHtml.includes(`data-source="'+escapeHtml(e.sourceId)`));
  assert.ok(investigatorHtml.includes(`data-item="'+escapeHtml(e.itemId)`));
});


test("retrieval ambiguities keep every candidate traceable to exact IPED evidence", () => {
  assert.ok(investigatorHtml.includes("ambiguityEvidenceButton"));
  assert.ok(investigatorHtml.includes('ambiguityTarget.querySelectorAll(".ambiguityEvidenceButton")'));
});


test("investigation synthesis observations link to their exact supporting evidence", () => {
  assert.ok(investigatorHtml.includes("analysisEvidenceButton"));
  assert.ok(investigatorHtml.includes('byId("analysis").querySelectorAll(".analysisEvidenceButton")'));
});


test("AI-assisted findings navigate to their cited IPED evidence", () => {
  assert.ok(investigatorHtml.includes("aiEvidenceButton"));
  assert.ok(investigatorHtml.includes('aiTarget.querySelectorAll(".aiEvidenceButton")'));
  assert.ok(investigatorHtml.includes('const parts=String(reference).split(":")'));
});


test("investigation leads expose the evidence that caused each correlation lead", () => {
  assert.ok(investigatorHtml.includes("leadEvidenceButton"));
  assert.ok(investigatorHtml.includes("(l.evidence||[]).map"));
});


test("graph search result selector disambiguates repeated labels by type", () => {
  assert.ok(investigatorHtml.includes('(node.label||node.id)+" · "+(node.entityType||node.kind)'));
});


test("evidence-to-entity layout separates forensic entity types into adaptive lanes", () => {
  assert.ok(investigatorHtml.includes('node.kind==="EVIDENCE"?"EVIDENCE":(node.entityType||node.kind)'));
  assert.ok(investigatorHtml.includes("laneEntries.length*190+100"));
  assert.ok(investigatorHtml.includes("laneIndex*190"));
});


test("hierarchical forensic lanes are visibly labeled", () => {
  assert.ok(investigatorHtml.includes("laneLabels"));
  assert.ok(investigatorHtml.includes("laneLabel"));
  assert.ok(investigatorHtml.includes("78+index*190"));
});


test("graph minimap viewport stays synchronized across resize and fullscreen changes", () => {
  assert.ok(investigatorHtml.includes('window.addEventListener("resize",updateMiniViewport'));
  assert.ok(investigatorHtml.includes("new ResizeObserver(updateMiniViewport)"));
  assert.ok(investigatorHtml.includes("graphResizeObserver?.observe(graphBox)"));
  assert.ok(investigatorHtml.includes("requestAnimationFrame(updateMiniViewport)"));
});


test("large graph minimap is an overlay outside the scrollable canvas", () => {
  assert.ok(investigatorHtml.includes("graphShell"));
  assert.ok(investigatorHtml.includes(".graphMiniMap{position:absolute"));
  assert.equal(investigatorHtml.includes(".graphMiniMap{position:sticky"), false);
});


test("fullscreen expands the graph shell so its minimap remains available", () => {
  assert.ok(investigatorHtml.includes(".graphShell.fullscreen"));
  assert.ok(investigatorHtml.includes('graphBox.closest(".graphShell")'));
  assert.ok(investigatorHtml.includes('graphShell.classList.toggle("fullscreen")'));
});


test("printed investigation avoids scroll clipping and navigation chrome", () => {
  assert.ok(investigatorHtml.includes("@media print"));
  assert.ok(investigatorHtml.includes(".graphMiniMap,.drawer{display:none!important}"));
  assert.ok(investigatorHtml.includes(".graphShell,.graph{overflow:visible!important"));
  assert.ok(investigatorHtml.includes(".graph svg{max-width:100%;height:auto}"));
});
