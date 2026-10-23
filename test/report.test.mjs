import assert from "node:assert/strict";
import { test } from "node:test";

import { buildReportHtml, collectReferences, noteReferences } from "../dist/report.js";

const ref = (itemId, sourceId = "resultado") => ({ sourceId, itemId });

function record(overrides = {}) {
  return {
    version: 1,
    id: "6b6638f5-5a72-46a7-8e15-5a7a3fc5bf5e",
    sourceId: "resultado",
    title: "Investigue Carlos Almeida",
    questions: ["Investigue Carlos Almeida", "Quais evidências mencionam Mariana Souza?"],
    createdAt: "2026-10-23T14:30:00.000Z",
    updatedAt: "2026-10-23T14:40:00.000Z",
    state: { id: "6b6638f5-5a72-46a7-8e15-5a7a3fc5bf5e" },
    workspace: {
      analysis: { headline: "A busca recuperou 9 evidência(s).", observations: [{ text: "O valor 18.750,00 foi observado.", evidence: [ref(5)] }] },
      panels: {
        evidence: [ref(8), ref(4)],
        retrievalAmbiguities: [{ description: "Nomes distintos.", candidates: [{ value: "Carlos Santos", evidence: [ref(1)] }] }],
        valueVariations: [{ type: "MONEY", description: "3 valores distintos." }]
      }
    },
    notes: [{ id: "n1", text: "Ver resultado:2 às 10:30 <script>alert(1)</script>", createdAt: "2026-10-23T14:50:00.000Z", updatedAt: "2026-10-23T14:50:00.000Z" }],
    claims: [
      {
        id: "c1",
        classification: "FACT",
        factBasis: "DOCUMENT_STATEMENT",
        statement: "O contrato registra R$ 18.750,00 <img src=x onerror=alert(1)>",
        supporting: [ref(4), ref(9)],
        contradicting: [],
        createdAt: "2026-10-23T14:45:00.000Z",
        updatedAt: "2026-10-23T14:45:00.000Z",
        verification: {
          checkedAt: "2026-10-23T14:45:00.000Z",
          referencesVerified: true,
          missing: [],
          duplicateGroups: [{ hash: "H", items: [ref(4), ref(9)] }],
          supportingCount: 2,
          independentSupportingCount: 1,
          warnings: ["Há evidências a favor com o mesmo conteúdo (mesmo hash); elas não contam como fontes independentes."],
          semanticSupportValidated: false
        }
      },
      {
        id: "c2",
        classification: "HYPOTHESIS",
        statement: "Pode haver um segundo pagamento.",
        supporting: [],
        contradicting: [ref(99)],
        createdAt: "2026-10-23T14:46:00.000Z",
        updatedAt: "2026-10-23T14:46:00.000Z"
      }
    ],
    events: [
      { id: "e2", date: "2026-03-14T10:30", approximate: false, description: "Reunião combinada por e-mail", evidence: [ref(7)], createdAt: "2026-10-23T14:47:00.000Z", updatedAt: "2026-10-23T14:47:00.000Z" },
      { id: "e1", date: "2026-02-01", approximate: true, description: "Assinatura do contrato <b>x</b>", evidence: [ref(4)], createdAt: "2026-10-23T14:48:00.000Z", updatedAt: "2026-10-23T14:48:00.000Z" }
    ],
    ...overrides
  };
}

test("references are collected from the result, claims, case events and notebook without duplicates", () => {
  const refs = collectReferences(record(), ["resultado"]).map(r => `${r.sourceId}:${r.itemId}`);
  assert.deepEqual(refs.sort(), ["resultado:2", "resultado:4", "resultado:7", "resultado:8", "resultado:9", "resultado:99"].sort());
});

test("note references respect word boundaries and escape the source id", () => {
  assert.deepEqual(noteReferences("resultado:3, xresultado:4, resultado:5a e 10:30", ["resultado"]), [ref(3)]);
  assert.deepEqual(noteReferences("caso.v1:7 e casoXv1:8", ["caso.v1"]), [{ sourceId: "caso.v1", itemId: 7 }]);
});

test("the report is a clearly labelled draft with every section", () => {
  const html = buildReportHtml({
    record: record(),
    evidence: [
      { ...ref(4), found: true, name: "contrato.txt", path: "MCP Lab/contrato.txt", hash: "H", bookmarks: ["Relevante"] },
      { ...ref(99), found: false }
    ],
    audit: [{ timestamp: "2026-10-23T14:30:00.000Z", action: "begin_investigation", details: "question: Investigue" }],
    generatedAt: "2026-10-23T15:00:00.000Z"
  });
  for (const expected of [
    "RASCUNHO — requer revisão do perito",
    "1. Pergunta investigativa",
    "Quais evidências mencionam Mariana Souza?",
    "2. Achados observados",
    "Carlos Santos",
    "3. Afirmações",
    "Fatos",
    "Hipóteses",
    "declaração em documento",
    "1 evidência(s) independente(s) a favor de 2 confirmada(s)",
    "4. Linha do tempo do caso",
    "01/02/2026 (aproximada)",
    "14/03/2026 10:30",
    "5. Caderno de análise",
    "6. Evidências referenciadas",
    "contrato.txt",
    "Relevante",
    "Não encontrada no caso no momento da geração.",
    "7. Rastreabilidade",
    "begin_investigation",
    "8. Limitações",
    "não avalia se o conteúdo prova a afirmação"
  ]) {
    assert.ok(html.includes(expected), `missing: ${expected}`);
  }
});

test("examiner and evidence text is escaped in the report", () => {
  const html = buildReportHtml({ record: record(), evidence: [], audit: [], generatedAt: "2026-10-23T15:00:00.000Z" });
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(!html.includes("<b>x</b>"));
});

test("an empty investigation still produces a complete, honest draft", () => {
  const html = buildReportHtml({
    record: record({ claims: [], notes: [], events: [], workspace: {} }),
    evidence: [],
    audit: [],
    generatedAt: "2026-10-23T15:00:00.000Z"
  });
  assert.ok(html.includes("Nenhuma afirmação foi registrada"));
  assert.ok(html.includes("Nenhuma nota foi registrada"));
  assert.ok(html.includes("Nenhum evento foi registrado"));
  assert.ok(html.includes("Nenhuma operação encontrada no log de auditoria."));
});

test("last activity includes notebook and claims changes", () => {
  const html = buildReportHtml({ record: record(), evidence: [], audit: [], generatedAt: "2026-10-23T15:00:00.000Z" });
  // Latest change is the note at 14:50 UTC (11:50 in Brasília), after the 14:40 search update.
  assert.ok(html.includes("última atividade em 23/10/2026, 11:50:00"), html.match(/última atividade em [^<]+/)?.[0]);
});

test("case events appear in chronological order regardless of entry order", () => {
  const html = buildReportHtml({ record: record(), evidence: [], audit: [], generatedAt: "2026-10-23T15:00:00.000Z" });
  assert.ok(html.indexOf("01/02/2026") < html.indexOf("14/03/2026 10:30"));
});
