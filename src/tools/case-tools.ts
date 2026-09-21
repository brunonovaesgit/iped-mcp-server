import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../tool-context.js";
import { toolResult } from "../tool-context.js";
import { InvestigatorService } from "../investigator-service.js";

export function registerCaseTools(
  server: McpServer,
  { iped, audit, investigations }: ToolContext
): void {
  server.tool(
    "list_bookmarks",
    "List bookmarks already present in the IPED case.",
    {},
    async () => {
      const bookmarks = await iped.listBookmarks();
      await audit.write("list_bookmarks", { results: bookmarks });
      return toolResult(bookmarks);
    }
  );

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
      return toolResult(evidence);
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
      return toolResult(categories);
    }
  );

  if (!investigations) {
    throw new Error("Investigation sessions are not available");
  }

  const investigator = new InvestigatorService(
    iped,
    investigations,
    audit
  );

  server.tool(
    "begin_investigation",
    "Start a forensic investigation from a natural-language question. When IPED exposes one source it is selected automatically; when several sources exist the client receives a simple selection state instead of requiring a sourceId.",
    {
      question: z.string().min(1),
      sourceId: z.string().optional()
    },
    async ({ question, sourceId }) => {
      return toolResult(await investigator.begin(question, sourceId));
    }
  );

  server.tool(
    "get_investigator_home",
    "Return a simple investigator-facing entry state for the current IPED environment. It hides MCP and IPED API details and tells the client whether investigation can start.",
    {
      sourceId: z.string().optional(),
      investigationId: z.string().uuid().optional()
    },
    async ({ sourceId, investigationId }) => {
      return toolResult(
        await investigator.home(sourceId, investigationId)
      );
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
        return toolResult(context);
      } catch (error) {
        await audit.write("get_case_context_failed", {
          sourceId,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  );
}
