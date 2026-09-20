import assert from "node:assert/strict";
import test from "node:test";

import { getConfig } from "../dist/config.js";

const variables = [
  "IPED_URL",
  "SEARCH_RESULT_LIMIT",
  "TEXT_LIMIT",
  "CONTENT_LIMIT",
  "AUDIT_LOG"
];

function preserveEnvironment() {
  return Object.fromEntries(
    variables.map(name => [name, process.env[name]])
  );
}

function restoreEnvironment(saved) {
  for (const name of variables) {
    const value = saved[name];

    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

test("uses the default configuration", () => {
  const saved = preserveEnvironment();

  try {
    for (const name of variables) {
      delete process.env[name];
    }

    const config = getConfig();

    assert.equal(config.ipedUrl, "http://127.0.0.1:8080");
    assert.equal(config.searchResultLimit, 50);
    assert.equal(config.textLimit, 50_000);
    assert.equal(config.contentLimit, 10_000_000);
    assert.equal(config.auditLog, "./audit/requests.jsonl");
  } finally {
    restoreEnvironment(saved);
  }
});

test("reads configuration from environment variables", () => {
  const saved = preserveEnvironment();

  try {
    process.env.IPED_URL = "http://localhost:9090/";
    process.env.SEARCH_RESULT_LIMIT = "25";
    process.env.TEXT_LIMIT = "2000";
    process.env.CONTENT_LIMIT = "5000";
    process.env.AUDIT_LOG = "./tmp/audit.jsonl";

    const config = getConfig();

    assert.equal(config.ipedUrl, "http://localhost:9090");
    assert.equal(config.searchResultLimit, 25);
    assert.equal(config.textLimit, 2000);
    assert.equal(config.contentLimit, 5000);
    assert.equal(config.auditLog, "./tmp/audit.jsonl");
  } finally {
    restoreEnvironment(saved);
  }
});

test("rejects invalid numeric limits", () => {
  const saved = preserveEnvironment();

  try {
    process.env.SEARCH_RESULT_LIMIT = "0";

    assert.throws(
      () => getConfig(),
      /SEARCH_RESULT_LIMIT must be a positive integer/
    );
  } finally {
    restoreEnvironment(saved);
  }
});

test("rejects non HTTP IPED URLs", () => {
  const saved = preserveEnvironment();

  try {
    process.env.IPED_URL = "file:///tmp/iped";

    assert.throws(
      () => getConfig(),
      /IPED_URL must be an HTTP or HTTPS URL/
    );
  } finally {
    restoreEnvironment(saved);
  }
});