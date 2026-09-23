import assert from "node:assert/strict";
import { test } from "node:test";

import { AuditLog } from "../dist/audit-log.js";
import { InvestigationSessions } from "../dist/investigation-sessions.js";
import { InvestigatorService } from "../dist/investigator-service.js";

function view(question, evidence, leads = []) {
  return {
    question,
    overview: {
      evidenceCount: evidence.length,
      relationshipCount: 0,
      entityCount: leads.length,
      communicationParticipantCount: 0,
      timelineEventCount: evidence.length,
      openLeadCount: 0
    },
    sections: {
      evidence: evidence.map(item => ({
        ...item,
        name: `Evidence ${item.itemId}`,
        textAvailable: true,
        actions: ["OPEN_EVIDENCE"]
      })),
      relationships: {
        summary: {
          nodeCount: evidence.length,
          edgeCount: 0,
          nodesByKind: {},
          edgesByRelationship: {}
        },
        nodes: [],
        edges: [],
        legend: {}
      },
      timeline: evidence.map((item, index) => ({
        ...item,
        name: `Evidence ${item.itemId}`,
        event: "created",
        timestamp: `2026-01-0${index + 1}T10:00:00Z`
      })),
      leads: [],
      progress: undefined
    },
    actions: ["ASK_FOLLOW_UP", "FILTER_RELATIONSHIPS", "EXPLORE_OPEN_LEADS"]
  };
}

function investigation(question, ids, leads = []) {
  const evidence = ids.map(itemId => ({
    sourceId: "case-1",
    itemId,
    name: `Evidence ${itemId}`,
    text: `Grounded text from evidence ${itemId}`
  }));
  return {
    matchedEvidence: evidence,
    recurringEntities: leads.map(lead => ({
      ...lead,
      evidence: [{ sourceId: "case-1", itemId: ids[0] }]
    })),
    recurringCommunicationParticipants: [],
    investigatorView: view(question, evidence, leads)
  };
}

test("runs the investigator flow from case discovery through follow-up and evidence review", async () => {
  const queries = [];
  const fakeIped = {
    async getCaseContext() {
      return { sources: [{ id: "case-1", name: "Caso demonstracao" }] };
    },
    async investigateEvidence(query, sourceId) {
      queries.push({ query, sourceId });
      if (query === "Carlos") {
        return investigation(query, [2], []);
      }
      return investigation(query, [1], [
        { type: "EMAIL", value: "carlos@example.test" }
      ]);
    },
    async getEvidence(sourceId, itemId) {
      return {
        source: sourceId,
        id: itemId,
        properties: {
          name: [`Evidence ${itemId}`],
          hash: [`HASH-${itemId}`]
        },
        bookmarks: [],
        selected: false
      };
    },
    async getText(sourceId, itemId) {
      return {
        sourceId,
        itemId,
        text: `Grounded text from evidence ${itemId}`,
        truncated: false
      };
    }
  };

  const audit = new AuditLog();
  const sessions = new InvestigationSessions();
  const service = new InvestigatorService(fakeIped, sessions, audit);

  const home = await service.home();
  assert.equal(home.status, "READY");
  assert.equal(home.sourceId, "case-1");
  assert.equal(home.sourceSelection.status, "SOURCE_SELECTED");

  const started = await service.begin("Investigue Carlos", undefined);
  assert.equal(started.status, "INVESTIGATION_READY");
  assert.equal(started.workspace.case.sourceId, "case-1");
  assert.equal(started.workspace.panels.evidence.length, 1);
  assert.equal(started.workspace.panels.leads[0].value, "carlos@example.test");

  const investigationId = started.workspace.investigationId;
  const continued = await service.continue(
    investigationId,
    "Carlos",
    "Carlos"
  );
  assert.equal(continued.status, "INVESTIGATION_UPDATED");
  assert.equal(continued.workspace.focus, "Carlos");
  assert.equal(continued.workspace.panels.evidence[0].itemId, 2);

  const detail = await service.evidence("case-1", 2);
  assert.deepEqual(detail.reference, { sourceId: "case-1", itemId: 2 });
  assert.equal(detail.hash, "HASH-2");
  assert.equal(detail.text, "Grounded text from evidence 2");

  const state = sessions.get(investigationId);
  assert.deepEqual(state.evidence, [
    { sourceId: "case-1", itemId: 1 },
    { sourceId: "case-1", itemId: 2 }
  ]);
  assert.deepEqual(queries, [
    { query: "Investigue Carlos", sourceId: "case-1" },
    { query: "Carlos", sourceId: "case-1" }
  ]);

  const actions = audit.entries().map(entry => entry.action);
  assert.ok(actions.includes("get_investigator_home"));
  assert.ok(actions.includes("begin_investigation"));
  assert.ok(actions.includes("continue_investigation"));
  assert.ok(actions.includes("open_investigator_evidence"));
});


test("lead expansion excludes same-value evidence without established context", async () => {
  const initialEvidence = [
    { sourceId: "case-1", itemId: 1, name: "atlas-a.txt", text: "Carlos Almeida Atlas 18.750", entities: [
      { type: "MONEY", value: "18.750,00" },
      { type: "PROJECT", value: "Atlas" }
    ], communication: { from: [], to: [] } },
    { sourceId: "case-1", itemId: 2, name: "atlas-b.txt", text: "Atlas 18.750", entities: [
      { type: "MONEY", value: "18.750,00" },
      { type: "PROJECT", value: "Atlas" }
    ], communication: { from: [], to: [] } }
  ];
  const expandedEvidence = [
    ...initialEvidence,
    { sourceId: "case-1", itemId: 3, name: "atlas-new.txt", text: "Atlas payment 18.750", entities: [
      { type: "MONEY", value: "18.750,00" },
      { type: "PROJECT", value: "Atlas" }
    ], communication: { from: [], to: [] } },
    { sourceId: "case-1", itemId: 4, name: "apollo.txt", text: "Carlos Santos Apollo 18.750", entities: [
      { type: "MONEY", value: "18.750,00" },
      { type: "PROJECT", value: "Apollo" }
    ], communication: { from: [], to: [] } }
  ];

  const makeInvestigation = (question, evidence) => ({
    matchedEvidence: evidence,
    recurringEntities: [
      { type: "MONEY", value: "18.750,00", evidence: evidence.map(item => ({ sourceId: item.sourceId, itemId: item.itemId })) }
    ],
    recurringCommunicationParticipants: [],
    investigatorView: view(question, evidence)
  });

  const fakeIped = {
    async getCaseContext() {
      return { sources: [{ id: "case-1", name: "Caso" }] };
    },
    async investigateEvidence(query) {
      return query === "18.750,00"
        ? makeInvestigation(query, expandedEvidence)
        : makeInvestigation(query, initialEvidence);
    }

  };

  const audit = new AuditLog();
  const sessions = new InvestigationSessions();
  const service = new InvestigatorService(fakeIped, sessions, audit);
  const started = await service.begin("Investigue Carlos Almeida");
  const id = started.workspace.investigationId;
  const expanded = await service.exploreLead(id, "MONEY", "18.750,00");

  assert.equal(expanded.status, "LEAD_EXPLORED");
  assert.deepEqual(
    sessions.get(id).evidence.map(item => item.itemId),
    [1, 2, 3]
  );
  assert.deepEqual(
    expanded.workspace.panels.evidence.map(item => item.itemId),
    [1, 2, 3]
  );
  assert.equal(expanded.workspace.summary.evidenceCount, 3);
  assert.equal(
    expanded.workspace.panels.evidence.some(item => item.itemId === 4),
    false
  );
  const auditEntry = audit.entries().find(entry => entry.action === "explore_investigation_lead");
  assert.equal(auditEntry.matchedEvidenceCount, 4);
  assert.equal(auditEntry.contextualEvidenceCount, 3);
});


test("repeated textual context never joins forensic fields across line boundaries", async () => {
  const audit = new AuditLog();
  const anchors = [
    { sourceId: "case-1", itemId: 1, name: "a.txt", text: "PROJETO ATLAS\n\nContratante: Carlos Almeida\nContratada: Orion Tecnologia Ltda", entities: [
      { type: "MONEY", value: "18.750,00", searchQuery: 'Regex\\:MONEY:"18.750,00"' }
    ], communication: { from: [], to: [] } },
    { sourceId: "case-1", itemId: 2, name: "b.txt", text: "PROJETO ATLAS\n\nContratante: Carlos Almeida\nContratada: Orion Tecnologia Ltda", entities: [
      { type: "MONEY", value: "18.750,00", searchQuery: 'Regex\\:MONEY:"18.750,00"' }
    ], communication: { from: [], to: [] } }
  ];
  const make = (question, evidence) => ({
    matchedEvidence: evidence, matchedEvidenceTruncated: false,
    matchedEvidenceAvailable: evidence.length,
    recurringEntities: [{ type: "MONEY", value: "18.750,00", evidence: anchors.map(item => ({ sourceId: item.sourceId, itemId: item.itemId })) }],
    recurringCommunicationParticipants: [], investigatorView: view(question, evidence)
  });
  const fakeIped = {
    async getCaseContext() { return { sources: [{ id: "case-1", name: "Caso" }] }; },
    async getEvidence(_sourceId, itemId) { return { sourceId: "case-1", itemId, properties: { "Regex:MONEY": ["18.750,00"] } }; },
    async investigateEvidence(query) { return make(query, anchors); }
  };
  const service = new InvestigatorService(fakeIped, new InvestigationSessions(), audit);
  const started = await service.begin("Carlos");
  await service.exploreLead(started.workspace.investigationId, "MONEY", "18.750,00");
  const diagnostic = [...audit.entries()].find(entry => entry.action === "context_correlation_diagnostics");
  const phrases = diagnostic.extractedContext.filter(item => item.type === "TEXT_PHRASE").map(item => item.value);
  assert.equal(phrases.some(value => value.includes("\n")), false);
  assert.equal(phrases.includes("PROJETO ATLAS"), true);
  assert.equal(phrases.includes("Orion Tecnologia Ltda"), true);
});

test("contextual expansion uses repeated anchor phrases when IPED has no structured project entity", async () => {
  const queries = [];
  const initial = [
    { sourceId: "case-1", itemId: 1, name: "a.txt", text: "Carlos Almeida trabalha no Projeto Atlas por 18.750.", entities: [
      { type: "MONEY", value: "18.750,00", searchQuery: 'Regex\\:MONEY:"18.750,00"' }
    ], communication: { from: [], to: [] } },
    { sourceId: "case-1", itemId: 2, name: "b.txt", text: "Pagamento do Projeto Atlas para Carlos Almeida: 18.750.", entities: [
      { type: "MONEY", value: "18.750,00", searchQuery: 'Regex\\:MONEY:"18.750,00"' }
    ], communication: { from: [], to: [] } }
  ];
  const divergent = { sourceId: "case-1", itemId: 3, name: "divergent.txt", text: "Comprovante do Projeto Atlas no valor 17.850.", entities: [
    { type: "MONEY", value: "17.850,00", searchQuery: 'Regex\\:MONEY:"17.850,00"' }
  ], communication: { from: [], to: [] } };
  const unrelated = { sourceId: "case-1", itemId: 4, name: "apollo.txt", text: "Projeto Apollo no valor 18.750.", entities: [
    { type: "MONEY", value: "18.750,00", searchQuery: 'Regex\\:MONEY:"18.750,00"' }
  ], communication: { from: [], to: [] } };
  const make = (question, evidence) => ({
    matchedEvidence: evidence,
    matchedEvidenceTruncated: false,
    matchedEvidenceAvailable: evidence.length,
    recurringEntities: [{
      type: "MONEY", value: "18.750,00",
      evidence: initial.map(item => ({ sourceId: item.sourceId, itemId: item.itemId }))
    }],
    recurringCommunicationParticipants: [],
    investigatorView: view(question, evidence)
  });
  const fakeIped = {
    async getCaseContext() { return { sources: [{ id: "case-1", name: "Caso" }] }; },
    async getEvidence(_sourceId, itemId) {
      return { sourceId: "case-1", itemId, properties: { "Regex:MONEY": ["18.750,00"] } };
    },
    async investigateEvidence(query) {
      queries.push(query);
      if (query === '"Projeto Atlas"') return make(query, [divergent]);
      if (query === "18.750,00") return make(query, [...initial, unrelated]);
      return make(query, initial);
    }
  };
  const service = new InvestigatorService(fakeIped, new InvestigationSessions(), new AuditLog());
  const started = await service.begin("Carlos");
  const expanded = await service.exploreLead(started.workspace.investigationId, "MONEY", "18.750,00");
  assert.equal(queries.includes('"Projeto Atlas"'), true);
  assert.equal(expanded.workspace.panels.evidence.some(item => item.itemId === 3), true);
  assert.equal(expanded.workspace.panels.evidence.some(item => item.itemId === 4), false);
});

test("contextual expansion enriches loaded anchors from authoritative IPED metadata", async () => {
  const queries = [];
  const initial = [
    { sourceId: "case-1", itemId: 1, name: "a.txt", text: "18.750", entities: [
      { type: "MONEY", value: "18.750,00", searchQuery: 'Regex\\:MONEY:"18.750,00"' }
    ], communication: { from: [], to: [] } },
    { sourceId: "case-1", itemId: 2, name: "b.txt", text: "18.750", entities: [
      { type: "MONEY", value: "18.750,00", searchQuery: 'Regex\\:MONEY:"18.750,00"' }
    ], communication: { from: [], to: [] } }
  ];
  const divergent = { sourceId: "case-1", itemId: 3, name: "divergent.txt", text: "Atlas 17.850", entities: [
    { type: "PROJECT", value: "Atlas", searchQuery: 'Regex\\:PROJECT:"Atlas"' },
    { type: "MONEY", value: "17.850,00", searchQuery: 'Regex\\:MONEY:"17.850,00"' }
  ], communication: { from: [], to: [] } };
  const make = (question, evidence) => ({
    matchedEvidence: evidence,
    matchedEvidenceTruncated: false,
    matchedEvidenceAvailable: evidence.length,
    recurringEntities: [{
      type: "MONEY", value: "18.750,00",
      evidence: initial.map(item => ({ sourceId: item.sourceId, itemId: item.itemId }))
    }],
    recurringCommunicationParticipants: [],
    investigatorView: view(question, evidence)
  });
  const fakeIped = {
    async getCaseContext() { return { sources: [{ id: "case-1", name: "Caso" }] }; },
    async getEvidence(_sourceId, itemId) {
      return { sourceId: "case-1", itemId, properties: {
        name: [itemId === 1 ? "a.txt" : "b.txt"],
        "Regex:MONEY": ["18.750,00"],
        "Regex:PROJECT": ["Atlas"]
      }};
    },
    async investigateEvidence(query) {
      queries.push(query);
      if (query === 'Regex\\:PROJECT:"Atlas"') return make(query, [divergent]);
      return make(query, initial);
    }
  };
  const service = new InvestigatorService(fakeIped, new InvestigationSessions(), new AuditLog());
  const started = await service.begin("Carlos");
  const expanded = await service.exploreLead(started.workspace.investigationId, "MONEY", "18.750,00");
  assert.equal(queries.includes('Regex\\:PROJECT:"Atlas"'), true);
  assert.deepEqual(
    expanded.workspace.panels.evidence.map(item => item.itemId).sort(),
    [1, 2, 3]
  );
});

test("contextual expansion preserves the exact IPED searchQuery supplied by indexed evidence", async () => {
  const queries = [];
  const initial = [
    { sourceId: "case-1", itemId: 1, name: "a.txt", text: "Atlas 18.750", entities: [
      { type: "MONEY", value: "18.750,00", searchQuery: 'Regex\\:MONEY:"18.750,00"' },
      { type: "PROJECT", value: "Atlas", searchQuery: 'custom-index-query-for-atlas' }
    ], communication: { from: [], to: [] } },
    { sourceId: "case-1", itemId: 2, name: "b.txt", text: "Atlas 18.750", entities: [
      { type: "MONEY", value: "18.750,00", searchQuery: 'Regex\\:MONEY:"18.750,00"' },
      { type: "PROJECT", value: "Atlas", searchQuery: 'custom-index-query-for-atlas' }
    ], communication: { from: [], to: [] } }
  ];
  const make = (question, evidence) => ({
    matchedEvidence: evidence,
    matchedEvidenceTruncated: false,
    matchedEvidenceAvailable: evidence.length,
    recurringEntities: [{
      type: "MONEY", value: "18.750,00",
      evidence: evidence.map(item => ({ sourceId: item.sourceId, itemId: item.itemId }))
    }],
    recurringCommunicationParticipants: [],
    investigatorView: view(question, evidence)
  });
  const fakeIped = {
    async getCaseContext() { return { sources: [{ id: "case-1", name: "Caso" }] }; },
    async investigateEvidence(query) {
      queries.push(query);
      return make(query, initial);
    }
  };
  const service = new InvestigatorService(fakeIped, new InvestigationSessions(), new AuditLog());
  const started = await service.begin("Carlos");
  await service.exploreLead(started.workspace.investigationId, "MONEY", "18.750,00");
  assert.equal(queries.includes("custom-index-query-for-atlas"), true);
});

test("optional contextual query failure does not abort correlation expansion", async () => {
  const initial = [
    { sourceId: "case-1", itemId: 1, name: "a.txt", text: "Atlas 18.750", entities: [
      { type: "MONEY", value: "18.750,00" },
      { type: "PROJECT", value: "Atlas" }
    ], communication: { from: [], to: [] } },
    { sourceId: "case-1", itemId: 2, name: "b.txt", text: "Atlas 18.750", entities: [
      { type: "MONEY", value: "18.750,00" },
      { type: "PROJECT", value: "Atlas" }
    ], communication: { from: [], to: [] } }
  ];
  const make = (question, evidence) => ({
    matchedEvidence: evidence,
    matchedEvidenceTruncated: false,
    matchedEvidenceAvailable: evidence.length,
    recurringEntities: [{
      type: "MONEY", value: "18.750,00",
      evidence: evidence.map(item => ({ sourceId: item.sourceId, itemId: item.itemId }))
    }],
    recurringCommunicationParticipants: [],
    investigatorView: view(question, evidence)
  });
  const fakeIped = {
    async getCaseContext() { return { sources: [{ id: "case-1", name: "Caso" }] }; },
    async investigateEvidence(query) {
      if (query.includes("Atlas")) {
        assert.equal(query, 'Regex\\:PROJECT:"Atlas"');
        throw new Error("IPED request failed: 500 Request failed.");
      }
      return make(query, initial);
    }
  };
  const audit = new AuditLog();
  const sessions = new InvestigationSessions();
  const service = new InvestigatorService(fakeIped, sessions, audit);
  const started = await service.begin("Carlos");
  const expanded = await service.exploreLead(started.workspace.investigationId, "MONEY", "18.750,00");

  assert.equal(expanded.status, "LEAD_EXPLORED");
  assert.deepEqual(expanded.workspace.panels.evidence.map(item => item.itemId), [1, 2]);
  assert.equal(
    audit.entries().some(entry =>
      entry.action === "context_correlation_query_failed" &&
      entry.contextValue === "Atlas"
    ),
    true
  );
});


test("explicit correlation selection never falls through to a different open correlation", async () => {
  const evidence = [
    { sourceId: "case-1", itemId: 1, name: "a.txt", text: "Atlas Carlos", entities: [], communication: { from: [], to: [] } }
  ];
  const fakeIped = {
    async getCaseContext() {
      return { sources: [{ id: "case-1", name: "Caso" }] };
    },
    async investigateEvidence(query) {
      return {
        matchedEvidence: evidence,
        recurringEntities: [
          { type: "PROJECT", value: "Atlas", evidence: [{ sourceId: "case-1", itemId: 1 }] },
          { type: "PERSON", value: "Carlos", evidence: [{ sourceId: "case-1", itemId: 1 }] }
        ],
        recurringCommunicationParticipants: [],
        investigatorView: view(query, evidence)
      };
    }
  };

  const audit = new AuditLog();
  const sessions = new InvestigationSessions();
  const service = new InvestigatorService(fakeIped, sessions, audit);
  const started = await service.begin("Investigue o caso");
  const id = started.workspace.investigationId;

  sessions.record(id, {
    exploredLead: { type: "PROJECT", value: "Atlas" }
  });

  const result = await service.exploreLead(id, "PROJECT", "Atlas");

  assert.equal(result.status, "CORRELATION_NOT_AVAILABLE");
  assert.equal(result.reason, "REQUESTED_CORRELATION_IS_NOT_OPEN");
  assert.equal(
    sessions.get(id).leads.find(item => item.value === "Carlos").status,
    "OPEN"
  );
  assert.ok(
    audit.entries().some(
      entry => entry.action === "explore_investigation_lead_not_available"
    )
  );
});


test("stale explicit correlation remains not-available even after investigation expansion stops", async () => {
  const evidence = [
    { sourceId: "case-1", itemId: 1, name: "a.txt", text: "Atlas", entities: [], communication: { from: [], to: [] } }
  ];
  const fakeIped = {
    async getCaseContext() {
      return { sources: [{ id: "case-1", name: "Caso" }] };
    },
    async investigateEvidence(query) {
      return {
        matchedEvidence: evidence,
        recurringEntities: [
          { type: "PROJECT", value: "Atlas", evidence: [{ sourceId: "case-1", itemId: 1 }] }
        ],
        recurringCommunicationParticipants: [],
        investigatorView: view(query, evidence)
      };
    }
  };

  const audit = new AuditLog();
  const sessions = new InvestigationSessions();
  const service = new InvestigatorService(fakeIped, sessions, audit);
  const started = await service.begin("Investigue Atlas");
  const id = started.workspace.investigationId;

  sessions.record(id, {
    expansion: true,
    expansionQuery: "Atlas",
    evidence: [],
    exploredLead: { type: "PROJECT", value: "Atlas" }
  });

  assert.equal(sessions.shouldExpand(id).reason, "NO_NEW_EVIDENCE");

  const result = await service.exploreLead(id, "PROJECT", "Atlas");

  assert.equal(result.status, "CORRELATION_NOT_AVAILABLE");
  assert.equal(result.reason, "REQUESTED_CORRELATION_IS_NOT_OPEN");
  assert.ok(
    audit.entries().some(
      entry => entry.action === "explore_investigation_lead_not_available"
    )
  );
});


test("workspace explicitly reports when the bounded evidence search is truncated", async () => {
  const evidence = [
    { sourceId: "case-1", itemId: 1, name: "a.txt", text: "Carlos", entities: [], communication: { from: [], to: [] } }
  ];
  const fakeIped = {
    async getCaseContext() {
      return { sources: [{ id: "case-1", name: "Caso" }] };
    },
    async investigateEvidence(query) {
      return {
        matchedEvidence: evidence,
        matchedEvidenceTruncated: true,
        matchedEvidenceAvailable: 37,
        recurringEntities: [],
        recurringCommunicationParticipants: [],
        investigatorView: view(query, evidence)
      };
    }
  };

  const service = new InvestigatorService(
    fakeIped,
    new InvestigationSessions(),
    new AuditLog()
  );
  const result = await service.begin("Investigue todas as evidências de Carlos");

  assert.equal(result.status, "INVESTIGATION_READY");
  assert.equal(result.workspace.resultState.evidenceSearchTruncated, true);
  assert.equal(result.workspace.resultState.evidenceSearchAvailable, 37);
});


test("correlation expansion keeps anchor context even when bounded search omits the anchor item", async () => {
  const anchor = {
    sourceId: "case-1",
    itemId: 1,
    name: "atlas-anchor.txt",
    text: "Atlas 18.750",
    entities: [
      { type: "MONEY", value: "18.750,00" },
      { type: "PROJECT", value: "Atlas" }
    ],
    communication: { from: [], to: [] }
  };
  const initialEvidence = [
    anchor,
    {
      sourceId: "case-1",
      itemId: 2,
      name: "atlas-second.txt",
      text: "Atlas 18.750",
      entities: [
        { type: "MONEY", value: "18.750,00" },
        { type: "PROJECT", value: "Atlas" }
      ],
      communication: { from: [], to: [] }
    }
  ];
  const boundedExpansion = [
    {
      sourceId: "case-1",
      itemId: 3,
      name: "atlas-new.txt",
      text: "Atlas payment 18.750",
      entities: [
        { type: "MONEY", value: "18.750,00" },
        { type: "PROJECT", value: "Atlas" }
      ],
      communication: { from: [], to: [] }
    },
    {
      sourceId: "case-1",
      itemId: 4,
      name: "apollo.txt",
      text: "Apollo 18.750",
      entities: [
        { type: "MONEY", value: "18.750,00" },
        { type: "PROJECT", value: "Apollo" }
      ],
      communication: { from: [], to: [] }
    }
  ];

  const makeInvestigation = (question, evidence) => ({
    matchedEvidence: evidence,
    recurringEntities: [{
      type: "MONEY",
      value: "18.750,00",
      evidence: evidence.map(item => ({
        sourceId: item.sourceId,
        itemId: item.itemId
      }))
    }],
    recurringCommunicationParticipants: [],
    investigatorView: view(question, evidence)
  });

  const fakeIped = {
    async getCaseContext() {
      return { sources: [{ id: "case-1", name: "Caso" }] };
    },
    async investigateEvidence(query) {
      return query === "18.750,00"
        ? makeInvestigation(query, boundedExpansion)
        : makeInvestigation(query, initialEvidence);
    },
    async getEvidence(sourceId, itemId) {
      const item = [...initialEvidence, ...boundedExpansion].find(candidate => candidate.sourceId === sourceId && candidate.itemId === itemId);
      return {
        sourceId,
        itemId,
        properties: Object.fromEntries((item?.entities ?? []).map(entity => [`Regex:${entity.type}`, [entity.value]]))
      };
    }
  };

  const sessions = new InvestigationSessions();
  const service = new InvestigatorService(fakeIped, sessions, new AuditLog());
  const started = await service.begin("Investigue Atlas");
  const id = started.workspace.investigationId;
  const expanded = await service.exploreLead(id, "MONEY", "18.750,00");

  assert.equal(expanded.status, "LEAD_EXPLORED");
  assert.deepEqual(
    expanded.workspace.panels.evidence.map(item => item.itemId).sort(),
    [1, 2, 3]
  );
  assert.equal(
    expanded.workspace.panels.evidence.some(item => item.itemId === 4),
    false
  );
  assert.deepEqual(
    sessions.get(id).evidence.map(item => item.itemId),
    [1, 2, 3]
  );
});


test("MVP acceptance: contextual expansion preserves provenance and excludes same-value false positives end to end", async () => {
  const initial = [
    { sourceId: "mcp-lab", itemId: 2, name: "comprovante-divergente.txt", text: "Projeto Atlas R$ 17.850,00", entities: [
      { type: "MONEY", value: "17.850,00" },
      { type: "PROJECT", value: "Atlas" }
    ], communication: { from: [], to: [] } },
    { sourceId: "mcp-lab", itemId: 3, name: "conversa.txt", text: "Carlos Almeida Projeto Atlas 18.750", entities: [
      { type: "MONEY", value: "18.750,00" },
      { type: "PROJECT", value: "Atlas" },
      { type: "PERSON", value: "Carlos Almeida" }
    ], communication: { from: [], to: [] } },
    { sourceId: "mcp-lab", itemId: 8, name: "email.txt", text: "Atlas 18.750 ATLAS-2026-0918", entities: [
      { type: "MONEY", value: "18.750,00" },
      { type: "PROJECT", value: "Atlas" },
      { type: "REFERENCE", value: "ATLAS-2026-0918" }
    ], communication: { from: [], to: [] } }
  ];
  const expansion = [
    { sourceId: "mcp-lab", itemId: 6, name: "pagamento.txt", text: "Orion Tecnologia Atlas 18.750", entities: [
      { type: "MONEY", value: "18.750,00" },
      { type: "PROJECT", value: "Atlas" }
    ], communication: { from: [], to: [] } },
    { sourceId: "mcp-lab", itemId: 1, name: "carlos-santos.txt", text: "Carlos Santos Apollo 18.750", entities: [
      { type: "MONEY", value: "18.750,00" },
      { type: "PROJECT", value: "Apollo" },
      { type: "PERSON", value: "Carlos Santos" }
    ], communication: { from: [], to: [] } }
  ];

  const make = (question, evidence) => ({
    matchedEvidence: evidence,
    matchedEvidenceTruncated: false,
    matchedEvidenceAvailable: evidence.length,
    recurringEntities: [
      {
        type: "MONEY",
        value: "18.750,00",
        evidence: evidence
          .filter(item => item.entities.some(entity => entity.type === "MONEY" && entity.value === "18.750,00"))
          .map(item => ({ sourceId: item.sourceId, itemId: item.itemId }))
      }
    ].filter(item => item.evidence.length > 1),
    recurringCommunicationParticipants: [],
    investigatorView: view(question, evidence)
  });

  const anchors = new Map(initial.map(item => [item.itemId, item]));
  const fakeIped = {
    async getCaseContext() {
      return { sources: [{ id: "mcp-lab", name: "MCP Lab" }] };
    },
    async investigateEvidence(query) {
      return query === "18.750,00" ? make(query, expansion) : make(query, initial);
    },
    async getEvidence(sourceId, itemId) {
      const item = [...initial, ...expansion].find(candidate => candidate.sourceId === sourceId && candidate.itemId === itemId);
      return {
        sourceId,
        itemId,
        properties: Object.fromEntries((item?.entities ?? []).map(entity => [`Regex:${entity.type}`, [entity.value]]))
      };
    }
  };

  const sessions = new InvestigationSessions();
  const service = new InvestigatorService(fakeIped, sessions, new AuditLog());
  const started = await service.begin("Investigue todas as evidências relacionadas a Carlos");
  const id = started.workspace.investigationId;

  assert.deepEqual(
    started.workspace.panels.evidence.map(item => item.itemId),
    [2, 3, 8]
  );

  const expanded = await service.exploreLead(id, "MONEY", "18.750,00");

  assert.equal(expanded.status, "LEAD_EXPLORED");
  assert.deepEqual(
    expanded.workspace.panels.evidence.map(item => item.itemId).sort(),
    [2, 3, 6, 8]
  );
  assert.equal(
    expanded.workspace.panels.evidence.some(item => item.itemId === 1),
    false
  );
  assert.deepEqual(
    sessions.get(id).evidence.map(item => item.itemId),
    [2, 3, 8, 6]
  );
});
