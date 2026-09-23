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
