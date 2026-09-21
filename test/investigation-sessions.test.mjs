import assert from "node:assert/strict";
import { test } from "node:test";

import { InvestigationSessions } from "../dist/investigation-sessions.js";

test("keeps investigation question, scope, searches and evidence together", () => {
  const sessions = new InvestigationSessions();
  const started = sessions.start(
    "Investigate Carlos Almeida and related transactions",
    "case-test"
  );

  const updated = sessions.record(started.id, {
    query: "Carlos Almeida",
    evidence: [
      { sourceId: "case-test", itemId: 10 },
      { sourceId: "case-test", itemId: 11 }
    ]
  });

  sessions.record(started.id, {
    query: "Carlos Almeida",
    evidence: [
      { sourceId: "case-test", itemId: 10 },
      { sourceId: "case-test", itemId: 12 }
    ]
  });

  const context = sessions.get(started.id);

  assert.ok(context);
  assert.equal(
    context.question,
    "Investigate Carlos Almeida and related transactions"
  );
  assert.equal(context.sourceId, "case-test");
  assert.deepEqual(context.queries, ["Carlos Almeida"]);
  assert.deepEqual(context.evidence, [
    { sourceId: "case-test", itemId: 10 },
    { sourceId: "case-test", itemId: 11 },
    { sourceId: "case-test", itemId: 12 }
  ]);
  assert.equal(updated.evidence.length, 2);
});

test("does not expose mutable internal investigation state", () => {
  const sessions = new InvestigationSessions();
  const started = sessions.start("Question");

  started.evidence.push({ sourceId: "tampered", itemId: 999 });

  const context = sessions.get(started.id);

  assert.ok(context);
  assert.deepEqual(context.evidence, []);
});

test("rejects updates for unknown investigation sessions", () => {
  const sessions = new InvestigationSessions();

  assert.throws(
    () => sessions.record("missing", { query: "test" }),
    /Unknown investigation session/
  );
});


test("stops automatic expansion at configured investigation boundaries", () => {
  const sessions = new InvestigationSessions();
  const started = sessions.start("Follow relevant evidence");

  assert.equal(
    sessions.shouldExpand(started.id, { maxExpansions: 2 }).expand,
    true
  );

  sessions.record(started.id, { expansion: true });
  sessions.record(started.id, { expansion: true });

  assert.deepEqual(
    sessions.shouldExpand(started.id, { maxExpansions: 2 }),
    {
      expand: false,
      reason: "EXPANSION_LIMIT_REACHED",
      expansions: 2,
      evidenceCount: 0
    }
  );
});

test("stops automatic expansion when the evidence context grows too large", () => {
  const sessions = new InvestigationSessions();
  const started = sessions.start("Bound evidence context");

  sessions.record(started.id, {
    evidence: [
      { sourceId: "case-test", itemId: 1 },
      { sourceId: "case-test", itemId: 2 }
    ]
  });

  assert.deepEqual(
    sessions.shouldExpand(started.id, { maxEvidence: 2 }),
    {
      expand: false,
      reason: "EVIDENCE_LIMIT_REACHED",
      expansions: 0,
      evidenceCount: 2
    }
  );
});
