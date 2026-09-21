import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../tool-context.js";
import { toolResult } from "../tool-context.js";
import { buildInvestigatorHome } from "../investigator-view.js";

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

  server.tool(
    "get_investigator_home",
    "Return a simple investigator-facing entry state for the current IPED environment. It hides MCP and IPED API details and tells the client whether investigation can start.",
    {
      sourceId: z.string().optional(),
      investigationId: z.string().uuid().optional()
    },
    async ({ sourceId, investigationId }) => {
      try {
        const context = await iped.getCaseContext(sourceId);
        const sources = Array.isArray(context.sources)
          ? context.sources
          : [];
        const session =
          investigationId && investigations
            ? investigations.get(investigationId)
            : undefined;

        if (investigationId && investigations && !session) {
          throw new Error(
            `Unknown investigation session: ${investigationId}`
          );
        }

        const progress =
          session && investigations
            ? investigations.progress(session.id)
            : undefined;

        const home = buildInvestigatorHome({
          caseAvailable: sources.length > 0,
          sourceId:
            sourceId ??
            (sources.length === 1
              ? (() => {
                  const source = sources[0];

                  if (
                    source &&
                    typeof source === "object" &&
                    "id" in source &&
                    typeof source.id === "string"
                  ) {
                    return source.id;
                  }

                  return undefined;
                })()
              : undefined),
          activeInvestigation:
            session && progress
              ? {
                  id: session.id,
                  question: session.question,
                  focus: session.focus,
                  evidenceCount: session.evidence.length,
                  openLeadCount: session.leads.filter(
                    lead => lead.status === "OPEN"
                  ).length,
                  status: progress.status
                }
              : undefined
        });

        await audit.write("get_investigator_home", {
          investigationId,
          sourceId,
          status: home.status,
          sourceCount: sources.length,
          activeInvestigation: Boolean(session)
        });

        return toolResult(home);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("Unknown investigation session:")
        ) {
          await audit.write("get_investigator_home_failed", {
            investigationId,
            sourceId,
            error: error.message
          });
          throw error;
        }

        const home = buildInvestigatorHome({
          caseAvailable: false,
          sourceId
        });

        await audit.write("get_investigator_home_unavailable", {
          investigationId,
          sourceId,
          error: error instanceof Error ? error.message : String(error)
        });

        return toolResult(home);
      }
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
