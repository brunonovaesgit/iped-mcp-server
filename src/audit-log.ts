import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export class AuditLog {
  private readonly serverSessionId = randomUUID();
  private sequence = 0;

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

    process.stderr.write(`[iped-mcp] ${line}\n`);

    if (!this.filename) return;

    await mkdir(dirname(this.filename), { recursive: true });
    await appendFile(this.filename, line + "\n", "utf8");
  }
}