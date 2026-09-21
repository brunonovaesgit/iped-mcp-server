import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AuditLog } from "../audit-log.js";
import type { InvestigationSessions } from "../investigation-sessions.js";
import { toolResult } from "../tool-context.js";

export function registerSessionTools(
  server: McpServer,
  sessions: InvestigationSessions,
  audit: AuditLog
): void {
  server.tool(
    "start_investigation",
    "Start an investigation context for a forensic question. The context keeps the original question, optional IPED source scope, searches and evidence references together so follow-up investigation can continue without losing provenance.",
    {
      question: z.string().min(1),
      sourceId: z.string().optional()
    },
    async ({ question, sourceId }) => {
      const session = sessions.start(question, sourceId);

      await audit.write("start_investigation", {
        investigationId: session.id,
        question,
        sourceId
      });

      return toolResult(session);
    }
  );

  server.tool(
    "continue_investigation",
    "Continue an existing investigation with a new investigator question or focus while preserving the original question, source scope, prior searches and evidence references.",
    {
      investigationId: z.string().uuid(),
      question: z.string().min(1),
      focus: z.string().min(1).optional()
    },
    async ({ investigationId, question, focus }) => {
      const session = sessions.record(investigationId, {
        followUp: question,
        focus: focus ?? question
      });

      await audit.write("continue_investigation", {
        investigationId,
        question,
        focus: session.focus,
        evidenceCount: session.evidence.length,
        queryCount: session.queries.length
      });

      return toolResult(session);
    }
  );

  server.tool(
    "check_investigation_expansion",
    "Check whether an investigation should continue expanding automatically. This guards against unbounded traversal while preserving the investigator's ability to explicitly deepen a relevant lead.",
    {
      investigationId: z.string().uuid(),
      maxExpansions: z.number().int().positive().max(50).optional(),
      maxEvidence: z.number().int().positive().max(1000).optional()
    },
    async ({ investigationId, maxExpansions, maxEvidence }) => {
      const decision = sessions.shouldExpand(investigationId, {
        maxExpansions,
        maxEvidence
      });

      await audit.write("check_investigation_expansion", {
        investigationId,
        ...decision
      });

      return toolResult(decision);
    }
  );

  server.tool(
    "get_investigation_context",
    "Read the current context of an investigation, including its original question, source scope, searches and evidence references already collected.",
    {
      investigationId: z.string().uuid()
    },
    async ({ investigationId }) => {
      const session = sessions.get(investigationId);

      if (!session) {
        throw new Error(
          `Unknown investigation session: ${investigationId}`
        );
      }

      await audit.write("get_investigation_context", {
        investigationId,
        evidenceCount: session.evidence.length,
        queryCount: session.queries.length
      });

      return toolResult(session);
    }
  );
}
