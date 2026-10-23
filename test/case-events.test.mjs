import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CaseEventInputError, missingEventEvidence, normalizeEventDate, normalizeEventInput } from "../dist/case-events.js";
import { InvestigationStore } from "../dist/investigation-store.js";
import { InvestigationSessions } from "../dist/investigation-sessions.js";

const ref = (itemId, sourceId = "caso") => ({ sourceId, itemId });

test("event dates accept a day or a day with time and reject impossible dates", () => {
  assert.equal(normalizeEventDate("2026-02-28"), "2026-02-28");
  assert.equal(normalizeEventDate(" 2024-02-29T23:59 "), "2024-02-29T23:59");
  for (const bad of ["2026-02-30", "2025-02-29", "2026-13-01", "26-01-01", "2026-01-01T24:00", "2026-01-01T10:60", "01/02/2026", "1800-01-01", 20260101]) {
    assert.throws(() => normalizeEventDate(bad), CaseEventInputError, String(bad));
  }
});

test("an event must describe what happened and cite where the date was read", () => {
  assert.throws(() => normalizeEventInput({ date: "2026-01-01", description: " ", evidence: [ref(1)] }), CaseEventInputError);
  assert.throws(() => normalizeEventInput({ date: "2026-01-01", description: "x", evidence: [] }), CaseEventInputError);
  assert.throws(() => normalizeEventInput({ date: "2026-01-01", description: "x", evidence: [{ sourceId: "caso", itemId: -1 }] }), CaseEventInputError);
  assert.throws(() => normalizeEventInput({ date: "2026-01-01", description: "x".repeat(1001), evidence: [ref(1)] }), CaseEventInputError);
  const event = normalizeEventInput({ date: "2026-01-01", description: "  Assinatura  ", evidence: [ref(1), ref(1)], approximate: "yes" });
  assert.deepEqual(event, { date: "2026-01-01", approximate: false, description: "Assinatura", evidence: [ref(1)] });
});

test("missing cited items are reported without blocking the record", async () => {
  const reader = { async getEvidence(sourceId, itemId) { if (itemId === 99) throw new Error("404"); return { sourceId, itemId, properties: {} }; } };
  const event = normalizeEventInput({ date: "2026-01-01", description: "x", evidence: [ref(1), ref(99)] });
  assert.deepEqual(await missingEventEvidence(reader, event), [ref(99)]);
});

test("events persist in chronological order and survive a new search result", async () => {
  const dir = await mkdtemp(join(tmpdir(), "events-"));
  const store = new InvestigationStore(dir);
  const sessions = new InvestigationSessions();
  const state = sessions.start("Investigue", "caso");
  await store.save(state, { panels: {} });

  const later = await store.addEvent(state.id, normalizeEventInput({ date: "2026-03-14T10:30", description: "Reunião", evidence: [ref(2)] }), []);
  const earlier = await store.addEvent(state.id, normalizeEventInput({ date: "2026-02-01", description: "Contrato", evidence: [ref(1)] }), []);
  assert.deepEqual((await store.listEvents(state.id)).map(e => e.id), [earlier.id, later.id]);

  await store.save(state, { panels: { evidence: [] } });
  assert.equal((await store.listEvents(state.id)).length, 2, "saving a new result keeps the examiner's events");

  const updated = await store.updateEvent(state.id, later.id, normalizeEventInput({ date: "2026-01-15", description: "Reunião (remarcada)", evidence: [ref(2)] }), [ref(2)]);
  assert.equal(updated.description, "Reunião (remarcada)");
  assert.deepEqual(updated.missing, [ref(2)]);
  assert.deepEqual((await store.listEvents(state.id)).map(e => e.id), [later.id, earlier.id]);

  assert.equal(await store.deleteEvent(state.id, earlier.id), true);
  assert.equal(await store.deleteEvent(state.id, earlier.id), false);
  assert.equal((await store.listEvents(state.id)).length, 1);
  assert.equal((await stat(join(dir, `${state.id}.json`))).mode & 0o777, 0o600);
});
