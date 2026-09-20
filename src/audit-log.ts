import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export class AuditLog {
  constructor(private readonly filename?: string) {}
  async write(action: string, details: Record<string, unknown> = {}): Promise<void> {
    const line = JSON.stringify({ timestamp: new Date().toISOString(), action, ...details });
    process.stderr.write(`[iped-mcp] ${line}\n`);
    if (!this.filename) return;
    await mkdir(dirname(this.filename), { recursive: true });
    await appendFile(this.filename, line + "\n", "utf8");
  }
}
