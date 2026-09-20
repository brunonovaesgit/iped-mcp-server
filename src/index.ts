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
  "get_evidence_entities",
  "Read structured values already extracted and indexed by IPED for an evidence item. Each entity includes a searchQuery that can be passed directly to search_evidence to find the same indexed value elsewhere in the case. A repeated value is a lead for investigation, not by itself proof of identity or relationship.",
  {
    sourceId: z.string().min(1),
    itemId: z.number().int().nonnegative()
  },
  async ({ sourceId, itemId }) => {
    try {
      const entities = await iped.getEvidenceEntities(sourceId, itemId);

      await audit.write("get_evidence_entities", {
        sourceId,
        itemId,
        entities: entities.entities
      });

      return result(entities);
    } catch (error) {
      await audit.write("get_evidence_entities_failed", {
        sourceId,
        itemId,
        error: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
  }
);
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
  "Find evidence structurally related to an IPED item, including its parent, children and other items with the same hash. Check the truncation flags before assuming the returned relationships are complete.",
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
        childrenTruncated: related.childrenTruncated,
        sameHash: related.sameHash,
        sameHashTruncated: related.sameHashTruncated
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
  "inspect_evidence",
  "Inspect an IPED evidence item in one step, returning its indexed metadata, extracted text, structured values and structural relationships. Use this as the primary tool when an investigation needs to understand an evidence item in detail.",
  {
    sourceId: z.string().min(1),
    itemId: z.number().int().nonnegative()
  },
  async ({ sourceId, itemId }) => {
    try {
      const inspection = await iped.inspectEvidence(sourceId, itemId);

      await audit.write("inspect_evidence", {
        sourceId,
        itemId,
        textCharacters: inspection.text.text.length,
        textTruncated: inspection.text.truncated,
        entities: inspection.entities.length,
        children: inspection.related.children.length,
        childrenTruncated: inspection.related.childrenTruncated,
        sameHash: inspection.related.sameHash.length,
        sameHashTruncated: inspection.related.sameHashTruncated
      });

      return result(inspection);
    } catch (error) {
      await audit.write("inspect_evidence_failed", {
        sourceId,
        itemId,
        error: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
  }
);
server.tool(
  "follow_evidence_leads",
  "Follow structured values already extracted by IPED from an evidence item and find where the same indexed values appear elsewhere in the case. Matching values are investigative leads and must not be treated by themselves as proof of identity, relationship or corroboration.",
  {
    sourceId: z.string().min(1),
    itemId: z.number().int().nonnegative()
  },
  async ({ sourceId, itemId }) => {
    try {
      const investigation = await iped.followEvidenceLeads(
        sourceId,
        itemId
      );

      await audit.write("follow_evidence_leads", {
        sourceId,
        itemId,
        leads: investigation.leads.map(lead => ({
          type: lead.type,
          value: lead.value,
          matches: lead.matches.length,
          truncated: lead.truncated
        }))
      });

      return result(investigation);
    } catch (error) {
      await audit.write("follow_evidence_leads_failed", {
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
server.tool(
  "get_case_context",
  "Describe the IPED investigation environment available to the agent, including sources, evidence categories and bookmarks. Use this to understand the case before starting a broad investigation.",
  {
    sourceId: z.string().optional()
  },
  async ({ sourceId }) => {
    try {
      const context = await iped.getCaseContext(sourceId);

      await audit.write("get_case_context", {
        sourceId,
        sources: context.sources,
        categories: context.categories,
        bookmarks: context.bookmarks
      });

      return result(context);
    } catch (error) {
      await audit.write("get_case_context_failed", {
        sourceId,
        error: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
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
            "Investigation workflow:",
            "- Use the IPED MCP tools autonomously to locate and inspect relevant evidence.",
            "- Inspect metadata and extracted text of relevant items.",
            "- Use original content when extracted text or metadata is insufficient for the investigation.",
            "- Follow parent, child and same-content relationships when they may add investigative value.",
            "- Correlate people, organizations, identifiers, values, dates and references found in the evidence.",
            "- Build a timeline when timestamps help explain the relationships.",
            "- Expand searches when findings from existing evidence justify further investigation.",
            "- Distinguish evidence that corroborates a relationship from coincidences, contradictions and duplicate content.",
            "",
            "Evidence rules:",
            "- Use exclusively evidence available through the IPED MCP server.",
            "- Do not use the web, external knowledge or information that is not present in the evidence.",
            "- Every factual finding must cite sourceId and itemId.",
            "- A FACT must be directly supported by evidence.",
            "- An INFERENCE must identify the evidence from which it was derived and must not be presented as a fact.",
            "- A HYPOTHESIS must be explicitly identified as unconfirmed.",
            "- Do not assign subjective confidence levels such as high, medium or low unless the evidence itself provides a defined confidence measure.",
            "- Do not treat similar names, values or identifiers as proof that records refer to the same person, organization, transaction or event.",
            "- When evidence conflicts, describe each conflicting version and cite the evidence supporting it. Do not decide which version is true merely because it appears in more items.",
            "- Evidence with identical hashes must not be counted as independent corroboration.",
            "- Do not treat file-system timestamps as dates of events described inside a document unless the evidence establishes that relationship.",
            "- If the available evidence cannot establish something, state that limitation explicitly.",
            "",
            "Write the result for a forensic investigator.",
            "- Begin with a concise answer to the investigative question.",
            "- Describe the relevant factual findings and relationships.",
            "- Identify contradictions and potentially relevant evidence when applicable.",
            "- Identify duplicate evidence when applicable and avoid treating duplicates as independent support.",
            "- Clearly separate facts, inferences and hypotheses.",
            "- Finish with the evidence references used, relevant limitations and unanswered investigative questions.",
            "- Do not expose MCP, API or implementation details unless they are necessary to explain a limitation."
          ]
            .filter(Boolean)
            .join("\n")
        }
      }
    ]
  })
);

server.registerPrompt(
  "analyze_bookmark",
  {
    title: "Analyze IPED Bookmark",
    description:
      "Analyze evidence selected by an investigator in an IPED bookmark and produce a traceable investigative analysis.",
    argsSchema: {
      bookmark: z.string().min(1),
      question: z.string().optional()
    }
  },
  ({ bookmark, question }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            `Analyze the IPED bookmark "${bookmark}".`,
            question ? `Investigation question: ${question}` : "",
            "",
            "Use the bookmark as the starting scope of the investigation.",
            "",
            "Investigation workflow:",
            "- Retrieve the evidence contained in the bookmark.",
            "- Inspect metadata and extracted text of relevant items.",
            "- Use original content when extracted text or metadata is insufficient for the investigation.",
            "- Follow parent, child and same-content relationships when they may add investigative value.",
            "- Correlate people, organizations, identifiers, values, dates and references found in the evidence.",
            "- Build a timeline when timestamps help explain the relationships.",
            "- Search for additional IPED evidence when findings from the bookmarked evidence justify expanding the investigation.",
            "- Distinguish evidence that corroborates a relationship from coincidences, contradictions and duplicate content.",
            "",
            "Evidence rules:",
            "- Use exclusively evidence available through the IPED MCP server.",
            "- Do not use the web, external knowledge or information that is not present in the evidence.",
            "- Every factual finding must cite sourceId and itemId.",
            "- A FACT must be directly supported by evidence.",
            "- An INFERENCE must identify the evidence from which it was derived and must not be presented as a fact.",
            "- A HYPOTHESIS must be explicitly identified as unconfirmed.",
            "- Do not assign subjective confidence levels such as high, medium or low unless the evidence itself provides a defined confidence measure.",
            "- Do not treat similar names, values or identifiers as proof that records refer to the same person, organization, transaction or event.",
            "- When evidence conflicts, describe each conflicting version and cite the evidence supporting it. Do not decide which version is true merely because it appears in more items.",
            "- Evidence with identical hashes must not be counted as independent corroboration.",
            "- Evidence found outside the bookmark must be identified as related evidence outside the initial scope.",
            "- Do not recommend adding, removing or reorganizing bookmark items. Evidence curation decisions belong to the investigator.",
            "- Do not treat file-system timestamps as dates of events described inside a document unless the evidence establishes that relationship.",
            "- If the available evidence cannot establish something, state that limitation explicitly.",
            "",
            "Write the result for a forensic investigator.",
            "- Begin with a concise investigative summary.",
            "- Describe the relevant factual findings and relationships.",
            "- Identify contradictions and potentially relevant evidence found outside the initial bookmark when applicable.",
            "- Identify duplicate evidence when applicable and avoid treating duplicates as independent support.",
            "- Clearly separate facts, inferences and hypotheses.",
            "- Finish with the evidence references used, relevant limitations and unanswered investigative questions.",
            "- Do not expose MCP, API or implementation details unless they are necessary to explain a limitation."
          ]
            .filter(Boolean)
            .join("\n")
        }
      }
    ]
  })
);
server.registerPrompt(
  "generate_investigation_report",
  {
    title: "Generate IPED Investigation Report",
    description:
      "Generate a structured investigative report grounded exclusively in evidence available through IPED.",
    argsSchema: {
      bookmark: z.string().min(1),
      question: z.string().optional()
    }
  },
  ({ bookmark, question }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            `Generate an investigative report starting from the IPED bookmark "${bookmark}".`,
            question ? `Investigation objective: ${question}` : "",
            "",
            "Investigation workflow:",
            "- Retrieve and inspect the evidence contained in the bookmark.",
            "- Inspect metadata and extracted text of relevant items.",
            "- Use original content when extracted text or metadata is insufficient.",
            "- Follow relevant parent, child and same-content relationships.",
            "- Search for additional IPED evidence when findings from the bookmarked evidence justify expanding the investigation.",
            "- Correlate people, organizations, identifiers, values, dates and references.",
            "- Identify contradictions, duplicate content and potentially misleading coincidences.",
            "",
            "Evidence rules:",
            "- Use exclusively evidence available through the IPED MCP server.",
            "- Do not use the web or external knowledge.",
            "- Every factual finding must cite sourceId and itemId.",
            "- Facts must be directly supported by evidence.",
            "- Inferences must identify their supporting evidence and must not be presented as facts.",
            "- Hypotheses must be explicitly identified as unconfirmed.",
            "- Do not assign subjective confidence levels unless the evidence provides a defined confidence measure.",
            "- Do not treat similar names, values or identifiers as proof of identity or relationship.",
            "- When evidence conflicts, report each version and its supporting evidence without choosing one merely because it appears more often.",
            "- Evidence with identical hashes must not be counted as independent corroboration.",
            "- File-system timestamps must not be presented as dates of events described in a document unless the evidence establishes that relationship.",
            "- Evidence found outside the bookmark must be identified as outside the initial scope.",
            "- Do not modify or recommend changes to evidence or bookmark curation.",
            "",
            "Report structure:",
            "1. Investigation scope",
            "2. Executive summary",
            "3. Factual findings",
            "4. People, organizations and identifiers",
            "5. Relevant relationships and correlations",
            "6. Chronology, when supported by evidence",
            "7. Conflicting evidence",
            "8. Related evidence found outside the initial scope",
            "9. Inferences",
            "10. Unconfirmed hypotheses",
            "11. Limitations and unanswered questions",
            "12. Evidence references",
            "",
            "Write for a forensic investigator who will review and validate the analysis.",
            "Use clear professional language.",
            "Do not describe MCP, API calls, tool usage or implementation details in the report.",
            "Do not present the report as a final expert conclusion or substitute for investigator validation."
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
