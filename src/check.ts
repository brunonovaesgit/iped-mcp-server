import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getConfig } from "./config.js";

function ok(message: string): void {
  console.log(`✓ ${message}`);
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function checkIped(ipedUrl: string): Promise<void> {
  let response: Response;

  try {
    response = await fetch(`${ipedUrl}/sources`, {
      signal: AbortSignal.timeout(5_000)
    });
  } catch (error) {
    fail(
      `Cannot reach IPED Web API at ${ipedUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!response.ok) {
    fail(
      `IPED Web API returned HTTP ${response.status} ${response.statusText}`
    );
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    fail("IPED Web API responded, but /sources did not return valid JSON");
  }

  ok(`IPED Web API reachable at ${ipedUrl}`);

  const sourceCount =
    typeof body === "object" &&
    body !== null &&
    "data" in body &&
    Array.isArray(body.data)
      ? body.data.length
      : null;

  if (sourceCount === null) {
    fail("IPED /sources response has an unexpected format");
  }

  if (sourceCount === 0) {
    fail("IPED Web API is running, but no evidence sources are available");
  }

  ok(`${sourceCount} IPED source${sourceCount === 1 ? "" : "s"} available`);
}

async function checkMcp(): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined
      )
    )
  });

  const client = new Client({
    name: "iped-environment-check",
    version: "1.0.0"
  });

  try {
    await client.connect(transport);

    const server = client.getServerVersion();

    if (server?.name !== "iped-mcp-server") {
      fail(
        `Unexpected MCP server identity: ${server?.name ?? "unknown"}`
      );
    }

    ok(`MCP server started (${server.name} ${server.version})`);

    const instructions = client.getInstructions();

    if (!instructions?.includes("digital evidence processed by IPED")) {
      fail("MCP server started without the expected investigation instructions");
    }

    ok("Investigation instructions available");

    if (!instructions.includes("untrusted data")) {
      fail("MCP server started without the evidence trust-boundary instructions");
    }

    ok("Evidence trust-boundary instructions available");

    const tools = await client.listTools();

    if (!tools.tools.length) {
      fail("MCP server started, but no tools are available");
    }

    ok(`${tools.tools.length} MCP tools available`);
  } catch (error) {
    fail(
      `MCP server check failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  console.log("IPED MCP Server - environment check\n");

  const majorVersion = Number(process.versions.node.split(".")[0]);

  if (majorVersion < 20) {
    fail(`Node.js ${process.version} detected. Node.js 20 or newer is required.`);
  }

  ok(`Node.js ${process.version}`);

  let config;

  try {
    config = getConfig();
    ok("Configuration loaded");
  } catch (error) {
    fail(
      `Invalid configuration: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  await checkIped(config.ipedUrl);
  await checkMcp();

  console.log("\nEnvironment ready.");
}

main().catch(error => {
  fail(error instanceof Error ? error.message : String(error));
});