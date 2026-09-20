import { getConfig } from "./config.js";

function ok(message: string): void {
  console.log(`✓ ${message}`);
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
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

  let response: Response;

  try {
    response = await fetch(`${config.ipedUrl}/sources`, {
      signal: AbortSignal.timeout(5_000)
    });
  } catch (error) {
    fail(
      `Cannot reach IPED Web API at ${config.ipedUrl}: ${
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

  ok(`IPED Web API reachable at ${config.ipedUrl}`);

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

  ok(
    `${sourceCount} IPED source${sourceCount === 1 ? "" : "s"} available`
  );

  console.log("\nEnvironment ready.");
}

main().catch(error => {
  fail(error instanceof Error ? error.message : String(error));
});