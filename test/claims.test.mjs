import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ClaimInputError, normalizeClaimInput, verifyClaim } from "../dist/claims.js";
import { InvestigationStore } from "../dist/investigation-store.js";
import { InvestigationSessions } from "../dist/investigation-sessions.js";

const ref = (itemId, sourceId = "caso") => ({ sourceId, itemId });

// Fake read-only IPED: items 1 and 2 share the same hash; 3 is unique; 99 does not exist.
const reader = {
  async getEvidence(sourceId, itemId) {
    const hashes = { 1: "HASH-A", 2: "HASH-A", 3: "HASH-B", 4: undefined };
    if (!(itemId in hashes)) throw new Error("IPED request failed: 404");
    return { sourceId, itemId, properties: hashes[itemId] ? { hash: [hashes[itemId]] } : {} };
  }
};

test("facts require a basis and supporting evidence", () => {
  assert.throws(() => normalizeClaimInput({ classification: "FACT", statement: "x", supporting: [ref(1)] }), ClaimInputError);
  assert.throws(
    () => normalizeClaimInput({ classification: "FACT", factBasis: "DOCUMENT_STATEMENT", statement: "x", supporting: [] }),
    ClaimInputError
  );
  const fact = normalizeClaimInput({
    classification: "FACT",
    factBasis: "DOCUMENT_STATEMENT",
    statement: "  O documento registra o valor.  ",
    supporting: [ref(1), ref(1)]
  });
  assert.equal(fact.statement, "O documento registra o valor.");
  assert.deepEqual(fact.supporting, [ref(1)], "duplicated references are collapsed");
});

test("claim input is validated", () => {
  for (const input of [
    {},
    { classification: "OPINION", statement: "x" },
    { classification: "HYPOTHESIS", statement: "   " },
    { classification: "HYPOTHESIS", statement: "x".repeat(2001) },
    { classification: "HYPOTHESIS", statement: "x", supporting: "caso:1" },
    { classification: "HYPOTHESIS", statement: "x", supporting: [{ sourceId: "caso", itemId: -1 }] },
    { classification: "HYPOTHESIS", statement: "x", supporting: [ref(1)], contradicting: [ref(1)] },
    { classification: "INFERENCE", factBasis: "DOCUMENT_STATEMENT", statement: "x" }
  ]) {
    if (input.classification === "INFERENCE") {
      // factBasis is silently ignored for non-facts.
      assert.equal(normalizeClaimInput(input).factBasis, undefined);
      continue;
    }
    assert.throws(() => normalizeClaimInput(input), ClaimInputError, JSON.stringify(input));
  }
  const hypothesis = normalizeClaimInput({ classification: "HYPOTHESIS", statement: "Talvez." });
  assert.deepEqual(hypothesis.supporting, []);
});

test("verification counts duplicates as one independent source and reports missing items", async () => {
  const claim = normalizeClaimInput({
    classification: "INFERENCE",
    statement: "Os pagamentos se referem ao mesmo projeto.",
    supporting: [ref(1), ref(2), ref(3), ref(99)],
    contradicting: [ref(4)]
  });
  const v = await verifyClaim(reader, claim);
  assert.equal(v.referencesVerified, false);
  assert.deepEqual(v.missing, [ref(99)]);
  assert.equal(v.supportingCount, 3);
  assert.equal(v.independentSupportingCount, 2);
  assert.deepEqual(v.duplicateGroups, [{ hash: "HASH-A", items: [ref(1), ref(2)] }]);
  assert.equal(v.semanticSupportValidated, false);
  assert.ok(v.warnings.some(w => w.includes("não encontrada")));
  assert.ok(v.warnings.some(w => w.includes("mesmo hash")));
});

test("facts get warnings for contradicting evidence and for combining several items", async () => {
  const fact = normalizeClaimInput({
    classification: "FACT",
    factBasis: "OBSERVED_METADATA",
    statement: "O valor é o mesmo nos dois documentos.",
    supporting: [ref(1), ref(3)],
    contradicting: [ref(4)]
  });
  const v = await verifyClaim(reader, fact);
  assert.equal(v.referencesVerified, true);
  assert.ok(v.warnings.some(w => w.includes("evidência contrária")));
  assert.ok(v.warnings.some(w => w.includes("inferência")));
});

test("claims are stored with the investigation and survive new results", async () => {
  const directory = await mkdtemp(join(tmpdir(), "iped-mcp-claims-"));
  const store = new InvestigationStore(directory);
  const sessions = new InvestigationSessions();
  const state = sessions.start("Com afirmações", "caso");
  await store.save(state, { round: 1 });

  const input = normalizeClaimInput({ classification: "HYPOTHESIS", statement: "Hipótese inicial.", supporting: [ref(3)] });
  const created = await store.addClaim(state.id, input, await verifyClaim(reader, input));
  await store.save(state, { round: 2 });
  assert.deepEqual((await store.listClaims(state.id)).map(c => c.statement), ["Hipótese inicial."]);

  const revised = normalizeClaimInput({ classification: "INFERENCE", statement: "Inferência revisada.", supporting: [ref(1), ref(2)] });
  const updated = await store.updateClaim(state.id, created.id, revised, await verifyClaim(reader, revised));
  assert.equal(updated.classification, "INFERENCE");
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.verification.independentSupportingCount, 1);

  const reverified = await store.updateClaim(state.id, created.id, undefined, await verifyClaim(reader, updated));
  assert.equal(reverified.statement, "Inferência revisada.");

  assert.equal(await store.deleteClaim(state.id, created.id), true);
  assert.deepEqual(await store.listClaims(state.id), []);
});

test("claim verification only reads from IPED", async () => {
  const source = await readFile(new URL("../src/claims.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|method:|Bookmark|writeFile/);
});
