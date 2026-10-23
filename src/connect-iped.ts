import { access, mkdtemp, writeFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import { findJava, stopChild, processedCaseRoot } from "./launcher-runtime.js";

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
  const selectedCase = resolve(options.casePath);
  const casePath = await processedCaseRoot(selectedCase);
  if (!casePath) throw new Error("Caso IPED inválido: index/data não encontrados.");
  const libPath = join(ipedHome, "lib");
  await requirePath(libPath, "IPED lib directory");
  await requirePath(casePath, "Processed IPED case");

  const sourceId = options.id || basename(selectedCase) || "iped-case";
  const java = await findJava(ipedHome);
  const temp = await mkdtemp(join(tmpdir(), "iped-mcp-"));
  const sourcesFile = join(temp, "sources.json");
  await writeFile(sourcesFile, JSON.stringify([{ id: sourceId, path: casePath }], null, 2));

  const webApiJar = join(libPath, "iped-webapi.jar");
  await requirePath(webApiJar, "IPED Web API");
  console.log("Connecting MCP to an existing IPED processed case");
  console.log(`IPED release : ${ipedHome}`);
  console.log(`Processed case: ${casePath}`);
  console.log(`Source id    : ${sourceId}`);
  console.log(`Web API      : http://${options.host}:${options.port}`);
  console.log("\nNo evidence is uploaded or modified. Keep this terminal open.\n");

  console.log(`Java          : ${java}`);
  const javaArgs = [
    "-jar", webApiJar,
    `--host=${options.host}`,
    `--port=${options.port}`,
    `--sources=${sourcesFile}`
  ];
  console.log(`Java command  : ${java} ${javaArgs.map(arg => JSON.stringify(arg)).join(" ")}`);
  console.log(`Sources file  : ${sourcesFile}`);

  const child = spawn(java, javaArgs, {
    cwd: ipedHome,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env
  });

  let stopping = false;
  const cleanup = () => rm(temp, { recursive: true, force: true });
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await stopChild(child);
    await cleanup();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
  let stdout = "", stderr = "";
  const keepTail = (current: string, chunk: Buffer | string) => (current + chunk.toString()).slice(-12000);
  child.stdout?.on("data", chunk => {
    stdout = keepTail(stdout, chunk);
    process.stdout.write(chunk);
  });
  child.stderr?.on("data", chunk => {
    stderr = keepTail(stderr, chunk);
    process.stderr.write(chunk);
  });
  child.on("error", error => {
    console.error(`Unable to start Java/IPED: ${error.message}`);
    void cleanup();
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    void cleanup();
    if (!stopping && ((code ?? 0) !== 0 || signal)) {
      console.error("\n--- IPED Web API startup diagnostics ---");
      console.error(`Exit code      : ${code ?? "null"}`);
      console.error(`Signal         : ${signal ?? "none"}`);
      console.error(`Working dir    : ${ipedHome}`);
      console.error(`Web API jar    : ${webApiJar}`);
      if (stderr.trim()) console.error("\nLast stderr:\n" + stderr.trim());
      if (stdout.trim()) console.error("\nLast stdout:\n" + stdout.trim());
      console.error("--- end diagnostics ---\n");
    }
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
