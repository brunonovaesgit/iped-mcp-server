import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AuditLog } from "./audit-log.js";
import { getConfig } from "./config.js";
import { IpedClient } from "./iped-client.js";

const config = getConfig();
const iped = new IpedClient(config);
const audit = new AuditLog(config.auditLog);
const server = new McpServer({ name: "iped-mcp-server", version: "0.1.0" });
const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

server.tool("list_cases", "List the IPED sources currently available to the server.", {}, async () => {
  const sources = await iped.listSources(); await audit.write("list_cases",{results:sources}); return result(sources);
});
server.tool("search_evidence", "Search evidence in IPED and return matching sourceId and itemId references. The query supports IPED field searches such as hash:<value>, md5:<value>, sha-256:<value>, trackId:<value>, type:<value>, category:\"<value>\", path:\"<value>\" and Regex\\:MONEY:\"<value>\". Use a plain term or quoted phrase for general content searches.", { query: z.string().min(1), sourceId: z.string().optional(), limit: z.number().int().positive().optional() }, async ({query,sourceId,limit}) => {
  const search = await iped.search(query,sourceId,limit); await audit.write("search_evidence",{query,sourceId,returned:search.matches.length,truncated:search.truncated,results:search.matches}); return result(search);
});
server.tool("get_evidence", "Read the indexed metadata for one evidence item.", { sourceId:z.string().min(1), itemId:z.number().int().nonnegative() }, async ({sourceId,itemId}) => {
  try {
    const evidence=await iped.getEvidence(sourceId,itemId);
    await audit.write("get_evidence",{sourceId,itemId});
    return result(evidence);
  } catch (error) {
    await audit.write("get_evidence_failed",{
      sourceId,
      itemId,
      error:error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
});
server.tool("get_evidence_text", "Read the text extracted by IPED for one evidence item.", { sourceId:z.string().min(1), itemId:z.number().int().nonnegative() }, async ({sourceId,itemId}) => {
  try {
    const evidence=await iped.getText(sourceId,itemId);
    await audit.write("get_evidence_text",{sourceId,itemId,returnedCharacters:evidence.text.length,truncated:evidence.truncated});
    return result(evidence);
  } catch (error) {
    await audit.write("get_evidence_text_failed",{
      sourceId,
      itemId,
      error:error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
});
server.tool(
  "get_evidence_content",
  "Read the original file associated with an IPED evidence item. Use this when the original artifact is needed instead of only its extracted text.",
  {
    sourceId: z.string().min(1),
    itemId: z.number().int().nonnegative()
  },
  async ({ sourceId, itemId }) => {
    try {
      const evidence = await iped.getContent(sourceId, itemId);

      await audit.write("get_evidence_content", {
        sourceId,
        itemId,
        filename: evidence.filename,
        mimeType: evidence.mimeType,
        size: evidence.size
      });

      return {
        content: [
          {
            type: "resource" as const,
            resource: {
              uri: `iped://evidence/${encodeURIComponent(sourceId)}/${itemId}/content`,
              mimeType: evidence.mimeType,
              blob: evidence.data
            }
          }
        ]
      };
    } catch (error) {
      await audit.write("get_evidence_content_failed", {
        sourceId,
        itemId,
        error: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
  }
);
server.tool(
  "get_related_evidence",
  "Find evidence structurally related to an IPED item, including its parent, children and other items with the same hash.",
  {
    sourceId: z.string().min(1),
    itemId: z.number().int().nonnegative()
  },
  async ({ sourceId, itemId }) => {
    try {
      const related = await iped.getRelatedEvidence(sourceId, itemId);

      await audit.write("get_related_evidence", {
        sourceId,
        itemId,
        parent: related.parent,
        children: related.children,
        sameHash: related.sameHash
      });

      return result(related);
    } catch (error) {
      await audit.write("get_related_evidence_failed", {
        sourceId,
        itemId,
        error: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
  }
);
server.tool(
  "get_evidence_timeline",
  "Build a chronological timeline from timestamps indexed by IPED for specific evidence items. Events are returned with sourceId and itemId so every timestamp remains traceable to its evidence.",
  {
    items: z.array(
      z.object({
        sourceId: z.string().min(1),
        itemId: z.number().int().nonnegative()
      })
    ).min(1).max(100)
  },
  async ({ items }) => {
    try {
      const timeline = await iped.getTimeline(items);

      await audit.write("get_evidence_timeline", {
        items,
        returnedEvents: timeline.events.length
      });

      return result(timeline);
    } catch (error) {
      await audit.write("get_evidence_timeline_failed", {
        items,
        error: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
  }
);
server.tool("list_bookmarks", "List bookmarks already present in the IPED case.", {}, async () => {
  const bookmarks=await iped.listBookmarks(); await audit.write("list_bookmarks",{results:bookmarks}); return result(bookmarks);
});
server.tool(
  "get_bookmark_evidence",
  "List the evidence items contained in an IPED bookmark.",
  {
    bookmark: z.string().min(1)
  },
  async ({ bookmark }) => {
    const evidence = await iped.getBookmarkEvidence(bookmark);

    await audit.write("get_bookmark_evidence", {
      bookmark,
      results: evidence
    });

    return result(evidence);
  }
);
server.tool(
  "list_categories",
  "List the evidence categories available in IPED.",
  {},
  async () => {
    const categories = await iped.listCategories();

    await audit.write("list_categories", {
      results: categories
    });

    return result(categories);
  }
);
server.registerPrompt(
  "investigate_evidence",
  {
    title: "Investigate IPED Evidence",
    description:
      "Investigate a question using only evidence available through the IPED MCP server.",
    argsSchema: {
      question: z.string().min(1),
      sourceId: z.string().optional()
    }
  },
  ({ question, sourceId }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            "Investigate the following question using exclusively evidence available in IPED.",
            "",
            `Question: ${question}`,
            sourceId ? `Case/source to investigate: ${sourceId}` : "",
            "",
            "Investigation rules:",
            "- Use the IPED MCP tools autonomously to locate and inspect relevant evidence.",
            "- Do not use the web, external knowledge or information that is not present in the evidence.",
            "- Follow relevant relationships between evidence when they may help answer the question.",
            "- Use metadata, extracted text, original content, bookmarks, relationships and timeline when relevant.",
            "- Every factual finding must identify its supporting evidence using sourceId and itemId.",
            "- Never present a file timestamp as the date of an event described inside that file unless the evidence establishes that relationship.",
            "- Distinguish clearly between FACT, INFERENCE and HYPOTHESIS.",
            "- A FACT must be directly supported by one or more evidence items.",
            "- An INFERENCE must identify the evidence used to derive it and must not be presented as a fact.",
            "- A HYPOTHESIS is an investigative possibility and must be explicitly identified as unconfirmed.",
            "- If the available evidence does not support an answer, say so instead of filling the gap.",
            "- Do not assume that two people, companies, accounts or identifiers are the same entity only because their names are similar.",
            "",
            "Present the result for an investigator, not for a software developer.",
            "Start with a concise answer to the investigative question.",
            "Then present the relevant findings and relationships.",
            "Include technical evidence references without exposing unnecessary MCP or API implementation details."
          ]
            .filter(Boolean)
            .join("\n")
        }
      }
    ]
  })
);
await audit.write("server_started",{ipedUrl:config.ipedUrl});
await server.connect(new StdioServerTransport());
