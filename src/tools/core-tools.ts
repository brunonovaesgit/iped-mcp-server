import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../tool-context.js";
import { toolResult } from "../tool-context.js";

export function registerCoreTools(
  server: McpServer,
  { iped, audit }: ToolContext
): void {
  server.tool(
    "list_cases",
    "List the IPED sources currently available to the server.",
    {},
    async () => {
      const sources = await iped.listSources();

      await audit.write("list_cases", {
        results: sources
      });

      return toolResult(sources);
    }
  );

  server.tool(
    "search_evidence",
    "Search evidence in IPED and return matching sourceId and itemId references. The query supports IPED field searches such as hash:<value>, md5:<value>, sha-256:<value>, trackId:<value>, type:<value>, category:\"<value>\", path:\"<value>\" and Regex\\:MONEY:\"<value>\". Use a plain term or quoted phrase for general content searches.",
    {
      query: z.string().min(1),
      sourceId: z.string().optional(),
      limit: z.number().int().positive().optional()
    },
    async ({ query, sourceId, limit }) => {
      const search = await iped.search(query, sourceId, limit);

      await audit.write("search_evidence", {
        query,
        sourceId,
        returned: search.matches.length,
        truncated: search.truncated,
        results: search.matches
      });

      return toolResult(search);
    }
  );
}
