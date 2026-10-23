import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

import { AuditLog } from "../dist/audit-log.js";
import {
  ExaminerBookmarks,
  BookmarkInputError,
  normalizeBookmarkName
} from "../dist/examiner-bookmarks.js";
import { isTrustedLocalWrite } from "../dist/investigator-http.js";

// Minimal fake of the IPED Web API bookmark endpoints.
let bookmarks;
let requests;
let server;
let ipedUrl;

before(async () => {
  server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? JSON.parse(raw) : undefined;
    const url = new URL(request.url, "http://iped.test");
    requests.push({ method: request.method, path: decodeURIComponent(url.pathname), body });

    if (request.method === "GET" && url.pathname === "/bookmarks") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({ data: [...bookmarks.keys()] }));
    }
    const match = decodeURIComponent(url.pathname).match(/^\/bookmarks\/([^/]+)(\/(add|remove))?$/);
    if (match && request.method === "POST" && !match[2]) {
      bookmarks.set(match[1], new Set());
      response.writeHead(200);
      return response.end();
    }
    if (match && request.method === "PUT" && match[3]) {
      const set = bookmarks.get(match[1]) ?? new Set();
      for (const doc of body) {
        const key = `${doc.source}:${doc.id}`;
        if (match[3] === "add") set.add(key);
        else set.delete(key);
      }
      bookmarks.set(match[1], set);
      response.writeHead(200);
      return response.end();
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  ipedUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

beforeEach(() => {
  bookmarks = new Map([["Existente", new Set()]]);
  requests = [];
});

function writer() {
  const audit = new AuditLog();
  return { audit, bookmarks: new ExaminerBookmarks({ ipedUrl }, audit) };
}

test("marking creates the bookmark when missing, adds the item and audits it", async () => {
  const { audit, bookmarks: examiner } = writer();
  const result = await examiner.mark("caso", 8, "  Relevante  ");

  assert.deepEqual(result, { sourceId: "caso", itemId: 8, bookmark: "Relevante", createdBookmark: true });
  assert.ok(bookmarks.get("Relevante").has("caso:8"));
  assert.deepEqual(
    requests.map(r => `${r.method} ${r.path}`),
    ["GET /bookmarks", "POST /bookmarks/Relevante", "PUT /bookmarks/Relevante/add"]
  );
  assert.deepEqual(requests[2].body, [{ source: "caso", id: 8 }]);
  const entry = audit.entries().at(-1);
  assert.equal(entry.action, "examiner_bookmark_add");
  assert.equal(entry.bookmark, "Relevante");
  assert.equal(entry.createdBookmark, true);
});

test("marking an existing bookmark does not recreate it", async () => {
  const { bookmarks: examiner } = writer();
  const result = await examiner.mark("caso", 3, "Existente");
  assert.equal(result.createdBookmark, false);
  assert.ok(!requests.some(r => r.method === "POST"));
  assert.ok(bookmarks.get("Existente").has("caso:3"));
});

test("unmarking removes only the item from the bookmark and audits it", async () => {
  const { audit, bookmarks: examiner } = writer();
  await examiner.mark("caso", 3, "Existente");
  requests = [];
  await examiner.unmark("caso", 3, "Existente");
  assert.deepEqual(requests.map(r => `${r.method} ${r.path}`), ["PUT /bookmarks/Existente/remove"]);
  assert.ok(bookmarks.has("Existente"), "the bookmark itself is never deleted");
  assert.ok(!bookmarks.get("Existente").has("caso:3"));
  assert.equal(audit.entries().at(-1).action, "examiner_bookmark_remove");
});

test("bookmark names are validated before any request reaches IPED", async () => {
  const { bookmarks: examiner } = writer();
  for (const bad of ["", "   ", "a/b", "a\\b", "x".repeat(81), "bell\u0007here", 42, undefined]) {
    await assert.rejects(examiner.mark("caso", 1, bad), BookmarkInputError);
  }
  await assert.rejects(examiner.mark("caso", -1, "Ok"), BookmarkInputError);
  await assert.rejects(examiner.mark("caso", 1.5, "Ok"), BookmarkInputError);
  assert.equal(requests.length, 0);
  assert.equal(normalizeBookmarkName("  A   B "), "A B");
  assert.equal(normalizeBookmarkName("tab\there"), "tab here");
});

test("examiner bookmark module never deletes, renames or touches the selection", async () => {
  const source = await readFile(new URL("../src/examiner-bookmarks.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /"DELETE"|\/rename|\/selection|\/docs\//);
  assert.match(source, /method: "GET" \| "POST" \| "PUT"/);
});

test("local write guard requires JSON from the loopback origin", () => {
  const ok = { "content-type": "application/json", host: "127.0.0.1:54024", origin: "http://127.0.0.1:54024" };
  assert.equal(isTrustedLocalWrite(ok), true);
  assert.equal(isTrustedLocalWrite({ ...ok, origin: undefined }), true);
  assert.equal(isTrustedLocalWrite({ ...ok, host: "localhost:3333", origin: "http://localhost:3333" }), true);
  assert.equal(isTrustedLocalWrite({ ...ok, "content-type": "text/plain" }), false, "simple cross-site POST");
  assert.equal(isTrustedLocalWrite({ ...ok, origin: "http://evil.test" }), false, "foreign origin");
  assert.equal(
    isTrustedLocalWrite({ ...ok, host: "evil.test:54024", origin: "http://evil.test:54024" }),
    false,
    "DNS rebinding"
  );
});

test("conflict guard blocks writes after the bookmark file is changed by another program", async () => {
  const { mkdtemp, writeFile, utimes } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { BookmarkStateGuard, BookmarkConflictError } = await import("../dist/examiner-bookmarks.js");

  const directory = await mkdtemp(join(tmpdir(), "iped-guard-"));
  const file = join(directory, "bookmarks.iped");
  await writeFile(file, "estado inicial");
  const base = new Date("2026-10-23T12:00:00Z");
  await utimes(file, base, base);

  const guard = new BookmarkStateGuard(file, 15_000, 300);
  const audit = new AuditLog();
  const examiner = new ExaminerBookmarks({ ipedUrl }, audit, guard);

  // Unchanged file: writing is allowed.
  await examiner.mark("caso", 1, "Relevante");

  // IPED desktop rewrites the state file a minute later.
  const later = new Date("2026-10-23T12:01:00Z");
  await utimes(file, later, later);
  requests = [];
  await assert.rejects(examiner.mark("caso", 2, "Relevante"), BookmarkConflictError);
  await assert.rejects(examiner.unmark("caso", 1, "Relevante"), BookmarkConflictError);
  assert.equal(requests.length, 0, "nothing reaches IPED when a conflict is detected");
  assert.equal(audit.entries().at(-1).action, "examiner_bookmark_conflict");
});

test("conflict guard accepts its own asynchronous save and is disabled without a case folder", async () => {
  const { mkdtemp, writeFile, utimes } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { BookmarkStateGuard } = await import("../dist/examiner-bookmarks.js");

  const directory = await mkdtemp(join(tmpdir(), "iped-guard-"));
  const file = join(directory, "bookmarks.iped");
  await writeFile(file, "estado");
  const old = new Date(Date.now() - 60_000);
  await utimes(file, old, old);

  const guard = new BookmarkStateGuard(file, 15_000, 200);
  await guard.assertUnchanged();
  // Our write lands only after the acknowledgement timeout (slow async save).
  await guard.acknowledgeOwnWrite();
  const now = new Date();
  await utimes(file, now, now);
  await guard.assertUnchanged(); // still treated as our own write

  const disabled = new BookmarkStateGuard(undefined);
  assert.equal(disabled.enabled, false);
  await disabled.assertUnchanged();
});
