import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AuditLog } from "../audit-log.js";
import type { InvestigationSessions } from "../investigation-sessions.js";
import type { IpedClient } from "../iped-client.js";
import {
  buildInvestigationResultState,
  buildInvestigationWorkspace,
  enrichInvestigatorView
} from "../investigator-view.js";
import { toolResult } from "../tool-context.js";

export function registerSessionTools(
  server: McpServer,
  sessions: InvestigationSessions,
  audit: AuditLog,
  iped?: IpedClient
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
      const current = sessions.get(investigationId);

      if (!current) {
        throw new Error(
          `Unknown investigation session: ${investigationId}`
        );
      }

      if (!iped) {
        const session = sessions.record(investigationId, {
          followUp: question,
          focus: focus ?? question
        });

        return toolResult(session);
      }

      const investigation = await iped.investigateEvidence(
        question,
        current.sourceId
      );
      const session = sessions.record(investigationId, {
        followUp: question,
        focus: focus ?? question,
        query: question,
        evidence: investigation.matchedEvidence.map(item => ({
          sourceId: item.sourceId,
          itemId: item.itemId
        })),
        leads: [
          ...investigation.recurringEntities.map(entity => ({
            type: entity.type,
            value: entity.value,
            evidence: entity.evidence
          })),
          ...investigation.recurringCommunicationParticipants.map(
            participant => ({
              type: "COMMUNICATION_PARTICIPANT",
              value: participant.value,
              evidence: participant.evidence
            })
          )
        ]
      });
      const progress = sessions.progress(investigationId);
      const investigatorView = enrichInvestigatorView(
        investigation.investigatorView,
        {
          leads: session.leads,
          progress
        }
      );

      await audit.write("continue_investigation", {
        investigationId,
        question,
        focus: session.focus,
        evidenceCount: session.evidence.length,
        queryCount: session.queries.length,
        matchedEvidenceCount: investigation.matchedEvidence.length
      });

      const resultState = buildInvestigationResultState({
        evidenceCount: investigation.matchedEvidence.length,
        openLeadCount: session.leads.filter(
          lead => lead.status === "OPEN"
        ).length,
        progress
      });

      return toolResult({
        status: "INVESTIGATION_UPDATED",
        workspace: buildInvestigationWorkspace({
          investigationId,
          question: session.question,
          focus: session.focus,
          sourceId: session.sourceId,
          view: investigatorView,
          resultState
        })
      });
    }
  );

  server.tool(
    "explore_investigation_lead",
    "Explore a specific evidence-backed lead selected by the investigator. The lead must already be open in the investigation, so arbitrary values cannot silently become evidence-backed relationships.",
    {
      investigationId: z.string().uuid(),
      leadType: z.string().min(1),
      leadValue: z.string().min(1)
    },
    async ({ investigationId, leadType, leadValue }) => {
      if (!iped) {
        throw new Error("IPED evidence access is not available");
      }

      const decision = sessions.shouldExpand(investigationId);

      if (!decision.expand) {
        return toolResult({
          status: "INVESTIGATION_STOPPED",
          reason: decision.reason,
          progress: sessions.progress(investigationId)
        });
      }

      const current = sessions.get(investigationId);

      if (!current) {
        throw new Error(
          `Unknown investigation session: ${investigationId}`
        );
      }

      const lead = sessions.lead(
        investigationId,
        leadType,
        leadValue
      );

      if (!lead) {
        return toolResult({
          status: "LEAD_NOT_AVAILABLE",
          message:
            "A pista selecionada não está aberta nesta investigação."
        });
      }

      const investigation = await iped.investigateEvidence(
        lead.value,
        current.sourceId
      );
      const session = sessions.record(investigationId, {
        query: lead.value,
        expansion: true,
        expansionQuery: lead.value,
        evidence: investigation.matchedEvidence.map(item => ({
          sourceId: item.sourceId,
          itemId: item.itemId
        })),
        leads: [
          ...investigation.recurringEntities.map(entity => ({
            type: entity.type,
            value: entity.value,
            evidence: entity.evidence
          })),
          ...investigation.recurringCommunicationParticipants.map(
            participant => ({
              type: "COMMUNICATION_PARTICIPANT",
              value: participant.value,
              evidence: participant.evidence
            })
          )
        ],
        exploredLead: {
          type: lead.type,
          value: lead.value
        }
      });
      const progress = sessions.progress(investigationId);
      const investigatorView = enrichInvestigatorView(
        investigation.investigatorView,
        {
          leads: session.leads,
          progress
        }
      );

      await audit.write("explore_investigation_lead", {
        investigationId,
        leadType: lead.type,
        leadValue: lead.value,
        sourceId: current.sourceId,
        matchedEvidenceCount: investigation.matchedEvidence.length,
        evidenceCount: session.evidence.length
      });

      const resultState = buildInvestigationResultState({
        evidenceCount: investigation.matchedEvidence.length,
        openLeadCount: session.leads.filter(
          item => item.status === "OPEN"
        ).length,
        progress
      });

      return toolResult({
        status: "LEAD_EXPLORED",
        exploredLead: lead,
        workspace: buildInvestigationWorkspace({
          investigationId,
          question: session.question,
          focus: session.focus,
          sourceId: session.sourceId,
          view: investigatorView,
          resultState
        })
      });;
    }
  );

  server.tool(
    "explore_next_lead",
    "Explore the next evidence-backed lead in the active investigation. This is a high-level continuation action for investigator interfaces: it respects expansion limits, searches only the investigation source, preserves provenance and marks the selected lead as explored.",
    {
      investigationId: z.string().uuid()
    },
    async ({ investigationId }) => {
      if (!iped) {
        throw new Error("IPED evidence access is not available");
      }

      const decision = sessions.shouldExpand(investigationId);

      if (!decision.expand) {
        return toolResult({
          status: "INVESTIGATION_STOPPED",
          reason: decision.reason,
          progress: sessions.progress(investigationId)
        });
      }

      const current = sessions.get(investigationId);

      if (!current) {
        throw new Error(
          `Unknown investigation session: ${investigationId}`
        );
      }

      const next = sessions.nextLead(investigationId);

      if (!next.available) {
        return toolResult({
          status: "NO_OPEN_LEADS",
          reason: next.reason,
          progress: sessions.progress(investigationId)
        });
      }

      const lead = next.lead;
      const investigation = await iped.investigateEvidence(
        lead.value,
        current.sourceId
      );
      const session = sessions.record(investigationId, {
        query: lead.value,
        expansion: true,
        expansionQuery: lead.value,
        evidence: investigation.matchedEvidence.map(item => ({
          sourceId: item.sourceId,
          itemId: item.itemId
        })),
        leads: [
          ...investigation.recurringEntities.map(entity => ({
            type: entity.type,
            value: entity.value,
            evidence: entity.evidence
          })),
          ...investigation.recurringCommunicationParticipants.map(
            participant => ({
              type: "COMMUNICATION_PARTICIPANT",
              value: participant.value,
              evidence: participant.evidence
            })
          )
        ],
        exploredLead: {
          type: lead.type,
          value: lead.value
        }
      });
      const progress = sessions.progress(investigationId);
      const investigatorView = enrichInvestigatorView(
        investigation.investigatorView,
        {
          leads: session.leads,
          progress
        }
      );

      await audit.write("explore_next_lead", {
        investigationId,
        leadType: lead.type,
        leadValue: lead.value,
        sourceId: current.sourceId,
        matchedEvidenceCount: investigation.matchedEvidence.length,
        evidenceCount: session.evidence.length,
        progressStatus: progress.status,
        progressReason: progress.reason
      });

      const resultState = buildInvestigationResultState({
        evidenceCount: investigation.matchedEvidence.length,
        openLeadCount: session.leads.filter(
          item => item.status === "OPEN"
        ).length,
        progress
      });

      return toolResult({
        status: "LEAD_EXPLORED",
        exploredLead: lead,
        workspace: buildInvestigationWorkspace({
          investigationId,
          question: session.question,
          focus: session.focus,
          sourceId: session.sourceId,
          view: investigatorView,
          resultState
        })
      });;
    }
  );

  server.tool(
    "get_investigation_progress",
    "Summarize whether an investigation should continue automatically or stop, based on evidence growth, expansion boundaries and remaining evidence-backed leads.",
    {
      investigationId: z.string().uuid()
    },
    async ({ investigationId }) => {
      const progress = sessions.progress(investigationId);

      await audit.write("get_investigation_progress", {
        investigationId,
        ...progress
      });

      return toolResult(progress);
    }
  );

  server.tool(
    "get_next_investigation_lead",
    "Return the next evidence-backed lead that has not yet been explored in an investigation. The lead remains an investigative direction, not a factual conclusion.",
    {
      investigationId: z.string().uuid()
    },
    async ({ investigationId }) => {
      const next = sessions.nextLead(investigationId);

      await audit.write("get_next_investigation_lead", {
        investigationId,
        available: next.available,
        ...(next.available
          ? {
              leadType: next.lead.type,
              leadValue: next.lead.value,
              evidenceCount: next.lead.evidence.length
            }
          : { reason: next.reason })
      });

      return toolResult(next);
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
