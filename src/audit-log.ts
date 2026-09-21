import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export class AuditLog {
  private readonly serverSessionId = randomUUID();
  private sequence = 0;
  private readonly recentEntries: Array<Record<string, unknown>> = [];

  constructor(private readonly filename?: string) {}

  async write(
    action: string,
    details: Record<string, unknown> = {}
  ): Promise<void> {
    this.sequence += 1;

    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      serverSessionId: this.serverSessionId,
      sequence: this.sequence,
      action,
      ...details
    });

    const entry = JSON.parse(line) as Record<string, unknown>;
    this.recentEntries.push(entry);
    if (this.recentEntries.length > 200) this.recentEntries.shift();

    process.stderr.write(`[iped-mcp] ${line}\n`);

    if (!this.filename) return;

    await mkdir(dirname(this.filename), { recursive: true });
    await appendFile(this.filename, line + "\n", "utf8");
  }

  entries(): ReadonlyArray<Record<string, unknown>> {
    return [...this.recentEntries];
  }
}