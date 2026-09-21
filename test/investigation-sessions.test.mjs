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

  sessions.record(started.id, {
    evidence: [{ sourceId: "case-test", itemId: 1 }],
    expansion: true
  });
  sessions.record(started.id, {
    evidence: [{ sourceId: "case-test", itemId: 2 }],
    expansion: true
  });

  assert.deepEqual(
    sessions.shouldExpand(started.id, { maxExpansions: 2 }),
    {
      expand: false,
      reason: "EXPANSION_LIMIT_REACHED",
      expansions: 2,
      evidenceCount: 2
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


test("stops automatic expansion when the last step found no new evidence", () => {
  const sessions = new InvestigationSessions();
  const started = sessions.start("Follow Carlos Almeida");

  sessions.record(started.id, {
    query: "Carlos Almeida",
    evidence: [{ sourceId: "case-test", itemId: 10 }]
  });

  sessions.record(started.id, {
    query: "person@example.test",
    evidence: [{ sourceId: "case-test", itemId: 10 }],
    expansion: true,
    expansionQuery: "person@example.test"
  });

  assert.deepEqual(sessions.shouldExpand(started.id), {
    expand: false,
    reason: "NO_NEW_EVIDENCE",
    expansions: 1,
    evidenceCount: 1
  });
});

test("allows another expansion when the last step discovered new evidence", () => {
  const sessions = new InvestigationSessions();
  const started = sessions.start("Follow Carlos Almeida");

  sessions.record(started.id, {
    evidence: [{ sourceId: "case-test", itemId: 10 }]
  });

  sessions.record(started.id, {
    query: "person@example.test",
    evidence: [
      { sourceId: "case-test", itemId: 10 },
      { sourceId: "case-test", itemId: 11 }
    ],
    expansion: true
  });

  assert.equal(sessions.shouldExpand(started.id).expand, true);
});


test("keeps follow-up questions without replacing the original investigation", () => {
  const sessions = new InvestigationSessions();
  const started = sessions.start(
    "Investigate Carlos Almeida and related transactions",
    "case-test"
  );

  sessions.record(started.id, {
    query: "Carlos Almeida",
    evidence: [{ sourceId: "case-test", itemId: 10 }]
  });

  sessions.record(started.id, {
    followUp: "Explore Maria",
    focus: "Maria"
  });

  sessions.record(started.id, {
    followUp: "Why is Maria connected to Orion?",
    focus: "Maria <-> Orion"
  });

  const context = sessions.get(started.id);

  assert.ok(context);
  assert.equal(
    context.question,
    "Investigate Carlos Almeida and related transactions"
  );
  assert.equal(context.focus, "Maria <-> Orion");
  assert.deepEqual(context.followUps, [
    "Explore Maria",
    "Why is Maria connected to Orion?"
  ]);
  assert.deepEqual(context.evidence, [
    { sourceId: "case-test", itemId: 10 }
  ]);
});
