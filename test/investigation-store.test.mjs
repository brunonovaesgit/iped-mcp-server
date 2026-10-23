import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InvestigationStore, isInvestigationId } from "../dist/investigation-store.js";
import { InvestigationSessions } from "../dist/investigation-sessions.js";

async function store() {
  const directory = await mkdtemp(join(tmpdir(), "iped-mcp-store-"));
  return { directory, store: new InvestigationStore(join(directory, "investigations")) };
}

function stateFor(sessions, question, sourceId = "caso") {
  return sessions.start(question, sourceId);
}

test("an investigation round-trips with its questions and rendered workspace", async () => {
  const { store: s } = await store();
  const sessions = new InvestigationSessions();
  const state = stateFor(sessions, "Pergunta inicial");
  sessions.record(state.id, { followUp: "E os pagamentos?", evidence: [{ sourceId: "caso", itemId: 8 }] });
  const current = sessions.get(state.id);
  const workspace = { investigationId: state.id, title: "Pergunta inicial", summary: { evidenceCount: 1 } };

  await s.save(current, workspace);
  const loaded = await s.load(state.id);

  assert.equal(loaded.title, "Pergunta inicial");
  assert.deepEqual(loaded.questions, ["Pergunta inicial", "E os pagamentos?"]);
  assert.deepEqual(loaded.workspace, workspace);
  assert.deepEqual(loaded.state.evidence, [{ sourceId: "caso", itemId: 8 }]);
});

test("saved files are private to the user", async () => {
  const { directory, store: s } = await store();
  const sessions = new InvestigationSessions();
  const state = stateFor(sessions, "Privado");
  await s.save(state, { investigationId: state.id });
  const info = await stat(join(directory, "investigations", `${state.id}.json`));
  assert.equal(info.mode & 0o777, 0o600);
});

test("listing is newest first and filtered by case source", async () => {
  const { store: s } = await store();
  const sessions = new InvestigationSessions();
  const first = stateFor(sessions, "Primeira", "caso-a");
  await s.save({ ...first, updatedAt: "2026-10-01T10:00:00.000Z" }, {});
  const second = stateFor(sessions, "Segunda", "caso-a");
  await s.save({ ...second, updatedAt: "2026-10-02T10:00:00.000Z" }, {});
  const other = stateFor(sessions, "Outro caso", "caso-b");
  await s.save(other, {});

  const listed = await s.list("caso-a");
  assert.deepEqual(listed.map(item => item.title), ["Segunda", "Primeira"]);
  assert.equal((await s.list()).length, 3);
});

test("invalid ids and corrupt files never break the listing", async () => {
  const { directory, store: s } = await store();
  const sessions = new InvestigationSessions();
  const state = stateFor(sessions, "Válida");
  await s.save(state, {});
  await writeFile(join(directory, "investigations", "00000000-0000-0000-0000-000000000000.json"), "{corrompido");
  await writeFile(join(directory, "investigations", "nota.txt"), "ignorar");

  assert.deepEqual((await s.list()).map(item => item.title), ["Válida"]);
  assert.equal(await s.load("../../etc/passwd"), undefined);
  assert.equal(isInvestigationId("../x"), false);
  await assert.rejects(s.save({ ...state, id: "../fora" }, {}));
});

test("a restored session accepts follow-ups without overwriting an active one", () => {
  const original = new InvestigationSessions();
  const state = original.start("Antes de reiniciar", "caso");

  const restarted = new InvestigationSessions();
  assert.equal(restarted.get(state.id), undefined);
  restarted.restore(state);
  restarted.record(state.id, { followUp: "Depois de reiniciar" });
  assert.deepEqual(restarted.get(state.id).followUps, ["Depois de reiniciar"]);

  restarted.restore({ ...state, question: "não deve sobrescrever" });
  assert.equal(restarted.get(state.id).question, "Antes de reiniciar");
});

test("the store never talks to IPED", async () => {
  const source = await readFile(new URL("../src/investigation-store.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|ipedUrl|IpedClient/);
});
