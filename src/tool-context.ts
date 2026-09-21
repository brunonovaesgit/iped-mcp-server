import type { AuditLog } from "./audit-log.js";
import type { IpedClient } from "./iped-client.js";

export interface ToolContext {
  iped: IpedClient;
  audit: AuditLog;
}

export function toolResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}
