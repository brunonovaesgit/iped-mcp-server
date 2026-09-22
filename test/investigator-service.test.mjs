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
