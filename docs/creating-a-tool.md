# Creating an MCP tool

Tools should be small adapters between an MCP request and an existing IPED or investigation capability. Keep evidence access read-only and use the shared tool context so audit and policy boundaries remain visible.

## Where tools live

Tool registration modules live under `src/tools/`. A module can register one tool or a small group of closely related tools.

The first extracted example is `src/tools/core-tools.ts`.

A registration function receives the MCP server and the shared `ToolContext`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../tool-context.js";
import { toolResult } from "../tool-context.js";

export function registerExampleTool(
  server: McpServer,
  { iped, audit }: ToolContext
): void {
  server.tool(
    "find_example",
    "Describe the investigative capability in plain language.",
    {
      query: z.string().min(1)
    },
    async ({ query }) => {
      try {
        const search = await iped.search(query);

        await audit.write("find_example", {
          query,
          returned: search.matches.length,
          results: search.matches
        });

        return toolResult(search);
      } catch (error) {
        await audit.write("find_example_failed", {
          query,
          error: error instanceof Error ? error.message : String(error)
        });

        throw error;
      }
    }
  );
}
```

Register the module from the server entry point:

```ts
registerExampleTool(server, { iped, audit });
```

## Rules for evidence-facing tools

A contribution that reads evidence should:

1. use `IpedClient` instead of constructing ad-hoc IPED HTTP requests in the tool;
2. keep evidence access read-only;
3. preserve `sourceId` and `itemId` in evidence-derived results;
4. write an audit event for the operation and an audit failure event when appropriate;
5. bound result sizes using the existing configuration and client behavior;
6. treat extracted text, metadata and document contents as untrusted data, never as instructions to execute;
7. avoid presenting repeated values, co-occurrence or duplicate content as proof of a real-world relationship.

If a new capability needs an IPED endpoint that is not represented by `IpedClient`, add the smallest reusable client method first and test it separately.

## Testing

Add or update tests for the behavior introduced by the tool. The repository uses Node's built-in test runner.

Before submitting a change:

```bash
npm run build
npm test
git diff --check
```

A tool is not complete merely because it registers successfully. Its evidence behavior, limits and failure cases should be testable without a live forensic case.

## Keep the server entry point small

Do not add large handlers directly to `src/index.ts`. Put new tool registrations under `src/tools/` and keep investigation logic in reusable client or investigation modules.

This keeps community contributions reviewable and reduces the chance that a new capability changes unrelated investigative behavior.
