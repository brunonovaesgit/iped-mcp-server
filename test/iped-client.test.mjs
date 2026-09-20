import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";

import { IpedClient } from "../dist/iped-client.js";

const items = {
  10: {
    source: "case-test",
    id: 10,
    luceneId: 110,
    properties: {
      name: ["origin.txt"],
      parentId: ["5"],
      hash: ["HASH-A"],
      "Regex:EMAIL": ["person@example.test"],
      "Regex:MONEY": ["18.750,00"]
    },
    bookmarks: [],
    selected: false
  },
  11: {
    source: "case-test",
    id: 11,
    luceneId: 111,
    properties: {
      name: ["same-email.txt"],
      hash: ["HASH-B"],
      "Regex:EMAIL": ["person@example.test"]
    },
    bookmarks: [],
    selected: false
  },
  12: {
    source: "case-test",
    id: 12,
    luceneId: 112,
    properties: {
      name: ["same-hash.txt"],
      hash: ["HASH-A"]
    },
    bookmarks: [],
    selected: false
  }
};

let server;
let baseUrl;

before(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");

    response.setHeader("Content-Type", "application/json");

    if (url.pathname === "/search") {
      const query = url.searchParams.get("q");

      const results = {
        "anything": [10, 11, 12],
        "parentId:10": [],
        "hash:HASH-A": [10, 12],
        'Regex\\:EMAIL:"person@example.test"': [10, 11],
        'Regex\\:MONEY:"18.750,00"': [10]
      };

      response.end(
        JSON.stringify({
          data: [
            {
              source: "case-test",
              ids: results[query] ?? []
            }
          ]
        })
      );

      return;
    }

    const documentMatch = url.pathname.match(
      /^\/sources\/case-test\/docs\/(\d+)$/
    );

    if (documentMatch) {
      const itemId = Number(documentMatch[1]);
      const item = items[itemId];

      if (!item) {
        response.statusCode = 404;
        response.end(JSON.stringify({ error: "not found" }));
        return;
      }

      response.end(JSON.stringify(item));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Could not determine mock server port");
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close(error => {
      if (error) reject(error);
      else resolve();
    });
  });
});

function client(searchResultLimit = 50) {
  return new IpedClient({
    ipedUrl: baseUrl,
    searchResultLimit,
    textLimit: 50_000,
    contentLimit: 10_000_000
  });
}

test("limits search results and reports truncation", async () => {
  const iped = client(2);

  const result = await iped.search("anything", "case-test");

  assert.deepEqual(result.matches, [
    { sourceId: "case-test", itemId: 10 },
    { sourceId: "case-test", itemId: 11 }
  ]);

  assert.equal(result.truncated, true);
});

test("returns structured values indexed by IPED", async () => {
  const iped = client();

  const result = await iped.getEvidenceEntities("case-test", 10);

  assert.deepEqual(result.entities, [
    {
      type: "EMAIL",
      value: "person@example.test",
      searchQuery: 'Regex\\:EMAIL:"person@example.test"'
    },
    {
      type: "MONEY",
      value: "18.750,00",
      searchQuery: 'Regex\\:MONEY:"18.750,00"'
    }
  ]);
});

test("finds parent and same-hash evidence", async () => {
  const iped = client();

  const result = await iped.getRelatedEvidence("case-test", 10);

  assert.deepEqual(result.parent, {
    sourceId: "case-test",
    itemId: 5
  });

  assert.deepEqual(result.sameHash, [
    {
      sourceId: "case-test",
      itemId: 12
    }
  ]);

  assert.equal(result.sameHashTruncated, false);
});

test("follows indexed evidence leads without returning the origin item", async () => {
  const iped = client();

  const result = await iped.followEvidenceLeads("case-test", 10);

  const email = result.leads.find(lead => lead.type === "EMAIL");
  const money = result.leads.find(lead => lead.type === "MONEY");

  assert.ok(email);
  assert.deepEqual(email.matches, [
    {
      sourceId: "case-test",
      itemId: 11
    }
  ]);

  assert.ok(money);
  assert.deepEqual(money.matches, []);
});