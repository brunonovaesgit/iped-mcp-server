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
