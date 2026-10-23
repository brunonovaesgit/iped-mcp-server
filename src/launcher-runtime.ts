import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
export const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const entryPoint = (name: string) => join(appRoot, "dist", name);

// IPED's own Web API (Sources.init / IPEDSource.MODULE_DIR) always appends "iped" onto
// the case path it is given, so the value we hand back (and later put in sources.json)
// must be the case ROOT that contains the "iped" module folder, never that folder itself.
export async function processedCaseRoot(path: string): Promise<string | undefined> {
  const resolved = resolve(path);
  const candidates = basename(resolved) === "iped" ? [resolved, dirname(resolved)] : [resolved];

  for (const caseRoot of candidates) {
    const moduleDir = join(caseRoot, "iped");
    try {
      await access(join(moduleDir, "index"), constants.R_OK);
      await access(join(moduleDir, "data"), constants.R_OK);
      return caseRoot;
    } catch {}
  }
}

export async function findJava(ipedHome: string): Promise<string> {
  const candidates = [
    process.env.JAVA_HOME && join(process.env.JAVA_HOME, "bin", "java"),
    join(ipedHome, "jre", "bin", "java"),
    join(ipedHome, "jre", "Contents", "Home", "bin", "java")
  ].filter((x): x is string => Boolean(x));
  if (process.platform === "darwin") {
    try {
      const { stdout } = await run("/usr/libexec/java_home", [], { timeout: 5000 });
      candidates.push(join(stdout.trim(), "bin", "java"));
    } catch {}
    candidates.push("/opt/homebrew/opt/openjdk@11/bin/java", "/opt/homebrew/opt/openjdk/bin/java");
  }
  candidates.push("/usr/bin/java", "/opt/homebrew/bin/java", "/usr/local/bin/java");
  if (process.platform === "win32") candidates.push("java");
  for (const candidate of [...new Set(candidates)]) {
    try {
      // /usr/bin/java may be an executable OS stub without a usable JVM.
      await run(candidate, ["-version"], { timeout: 5000 });
      return candidate;
    } catch {}
  }
  throw new Error("Java não encontrado ou não executável. Instale uma versão Java compatível com sua instalação do IPED e abra o IPED MCP novamente.");
}

export async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(done => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, 5000);
    const finish = () => { clearTimeout(timer); done(); };
    child.once("exit", finish);
    child.kill("SIGTERM");
  });
}
