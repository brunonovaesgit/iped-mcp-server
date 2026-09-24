import { access, mkdtemp, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import { spawn } from "node:child_process";

type Options = { ipedHome?: string; casePath?: string; id?: string; host: string; port: string };

function usage(): never {
  console.error(`Usage:
  npm run connect:iped -- --iped-home "/path/to/iped-release" --case "/path/to/processed-case" [--id case-name]

This command does not import, upload or modify evidence. It exposes an existing processed IPED case
through IPED's local Web API so the MCP/Investigator can read it.`);
  process.exit(1);
}

function parseArgs(args: string[]): Options {
  const options: Options = { host: "127.0.0.1", port: "8080" };
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i], value = args[i + 1];
    if (!value || value.startsWith("--")) usage();
    if (key === "--iped-home") options.ipedHome = value;
    else if (key === "--case") options.casePath = value;
    else if (key === "--id") options.id = value;
    else if (key === "--host") options.host = value;
    else if (key === "--port") options.port = value;
    else usage();
    i += 1;
  }
  return options;
}

async function requirePath(path: string, label: string): Promise<void> {
  try { await access(path, constants.R_OK); }
  catch { throw new Error(`${label} not found or not readable: ${path}`); }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.ipedHome || !options.casePath) usage();

  const ipedHome = resolve(options.ipedHome);
  const casePath = resolve(options.casePath);
  const libPath = join(ipedHome, "lib");
  await requirePath(libPath, "IPED lib directory");
  await requirePath(casePath, "Processed IPED case");

  const sourceId = options.id || basename(casePath) || "iped-case";
  const temp = await mkdtemp(join(tmpdir(), "iped-mcp-"));
  const sourcesFile = join(temp, "sources.json");
  await writeFile(sourcesFile, JSON.stringify([{ id: sourceId, path: casePath }], null, 2));

  const classpath = join(libPath, "*");
  console.log("Connecting MCP to an existing IPED processed case");
  console.log(`IPED release : ${ipedHome}`);
  console.log(`Processed case: ${casePath}`);
  console.log(`Source id    : ${sourceId}`);
  console.log(`Web API      : http://${options.host}:${options.port}`);
  console.log("\nNo evidence is uploaded or modified. Keep this terminal open.\n");

  const child = spawn("java", [
    "-cp", classpath,
    "iped.engine.webapi.Main",
    `--host=${options.host}`,
    `--port=${options.port}`,
    `--sources=${sourcesFile}`
  ], { cwd: ipedHome, stdio: "inherit", env: process.env });

  child.on("error", error => {
    console.error(`Unable to start Java/IPED: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", code => { process.exitCode = code ?? 0; });
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
