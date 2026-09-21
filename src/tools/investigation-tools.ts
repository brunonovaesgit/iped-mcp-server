import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../tool-context.js";
import { toolResult } from "../tool-context.js";

export function registerInvestigationTools(
  server: McpServer,
  { iped, audit, investigations }: ToolContext
): void {
  server.tool(
    "investigate_relationship",
    "Investigate whether two people, organizations, identifiers or other search terms are connected in IPED evidence. Finds evidence matching each side, evidence containing both terms, structured values connecting evidence, and direct mentions in IPED communication metadata. Returned connections are investigative paths and do not by themselves prove a real-world relationship.",
    {
      leftQuery: z.string().min(1),
      rightQuery: z.string().min(1),
      sourceId: z.string().optional(),
      limit: z.number().int().positive().max(100).optional()
    },
    async ({ leftQuery, rightQuery, sourceId, limit }) => {
      try {
        const investigation = await iped.investigateRelationship(
          leftQuery,
          rightQuery,
          sourceId,
          limit
        );

        await audit.write("investigate_relationship", {
          leftQuery,
          rightQuery,
          sourceId,
          leftEvidence: investigation.left.evidence,
          rightEvidence: investigation.right.evidence,
          sharedEvidence: investigation.sharedEvidence,
          connectionCount: investigation.connections.length,
          communicationMentionCount:
            investigation.communicationMentions.length
        });

        return toolResult(investigation);
      } catch (error) {
        await audit.write("investigate_relationship_failed", {
          leftQuery,
          rightQuery,
          sourceId,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  );

  server.tool(
    "investigate_evidence",
    "Start a focused investigation from a natural-language search term or IPED query. Returns matching evidence with extracted text, source scope, indexed entities, communication context, duplicate-content groups and explicit links between evidence that shares recurring indexed values. Use this as the default starting point for broad investigative questions before expanding only the relevant leads. When results span multiple IPED sources, preserve that source boundary in the analysis.",
    {
      query: z.string().min(1),
      sourceId: z.string().optional(),
      limit: z.number().int().positive().max(100).optional(),
      investigationId: z.string().uuid().optional()
    },
    async ({ query, sourceId, limit, investigationId }) => {
      try {
        const investigation = await iped.investigateEvidence(
          query,
          sourceId,
          limit
        );

        if (investigationId) {
          if (!investigations) {
            throw new Error("Investigation context is not available");
          }

          investigations.record(investigationId, {
            query,
            evidence: investigation.matchedEvidence.map(item => ({
              sourceId: item.sourceId,
              itemId: item.itemId
            }))
          });
        }

        await audit.write("investigate_evidence", {
          investigationId,
          query,
          sourceId,
          matchedEvidence: investigation.matchedEvidence.map(item => ({
            sourceId: item.sourceId,
            itemId: item.itemId
          })),
          matchedEvidenceTruncated:
            investigation.matchedEvidenceTruncated,
          sourceCount: investigation.scope.sources.length,
          spansMultipleSources:
            investigation.scope.spansMultipleSources,
          entityCount: investigation.entities.length,
          recurringEntityCount: investigation.recurringEntities.length,
          communicationParticipantCount:
            investigation.communicationParticipants.length,
          recurringCommunicationParticipantCount:
            investigation.recurringCommunicationParticipants.length,
          crossEvidenceLinkCount:
            investigation.crossEvidenceLinks.length,
          duplicateGroupCount: investigation.duplicateEvidence.length,
          textUnavailable: investigation.matchedEvidence
            .filter(item => !item.textAvailable)
            .map(item => ({
              sourceId: item.sourceId,
              itemId: item.itemId,
              error: item.textError
            }))
        });

        return toolResult(investigation);
      } catch (error) {
        await audit.write("investigate_evidence_failed", {
          investigationId,
          query,
          sourceId,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  );

  server.tool(
    "investigate_entity",
    "Investigate a person, organization, identifier or other term across an IPED case. Finds initial evidence matching the term and expands structured entities found in that evidence to reveal additional evidence connections. Connections are investigative leads and do not by themselves prove identity or relationship.",
    {
      query: z.string().min(1),
      sourceId: z.string().optional(),
      limit: z.number().int().positive().max(100).optional()
    },
    async ({ query, sourceId, limit }) => {
      try {
        const investigation = await iped.investigateEntity(
          query,
          sourceId,
          limit
        );

        await audit.write("investigate_entity", {
          query,
          sourceId,
          initialEvidence: investigation.initialEvidence.map(item => ({
            sourceId: item.sourceId,
            itemId: item.itemId
          })),
          connectionCount: investigation.connections.length,
          communicationParticipantCount:
            investigation.communicationParticipants.length,
          initialSearchTruncated: investigation.initialSearchTruncated
        });

        return toolResult(investigation);
      } catch (error) {
        await audit.write("investigate_entity_failed", {
          query,
          sourceId,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  );

  server.tool(
    "trace_entity_paths",
    "Trace evidence paths from a person, organization, identifier or other search term through structured values indexed by IPED. Each path records the evidence items and the indexed value that connected them. Paths are investigative leads, not proof of real-world identity or relationship.",
    {
      query: z.string().min(1),
      sourceId: z.string().optional(),
      depth: z.number().int().min(1).max(3).optional(),
      limit: z.number().int().positive().max(100).optional()
    },
    async ({ query, sourceId, depth, limit }) => {
      try {
        const paths = await iped.traceEntityPaths(
          query,
          sourceId,
          depth,
          limit
        );

        await audit.write("trace_entity_paths", {
          query,
          sourceId,
          depth: paths.depth,
          initialEvidence: paths.initialEvidence,
          pathCount: paths.paths.length,
          initialSearchTruncated: paths.initialSearchTruncated
        });

        return toolResult(paths);
      } catch (error) {
        await audit.write("trace_entity_paths_failed", {
          query,
          sourceId,
          depth,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  );

  server.tool(
    "get_evidence_timeline",
    "Build a chronological timeline from timestamps indexed by IPED for specific evidence items. Events are returned with sourceId and itemId so every timestamp remains traceable to its evidence.",
    {
      items: z.array(
        z.object({
          sourceId: z.string().min(1),
          itemId: z.number().int().nonnegative()
        })
      ).min(1).max(100)
    },
    async ({ items }) => {
      try {
        const timeline = await iped.getTimeline(items);
        await audit.write("get_evidence_timeline", {
          items,
          returnedEvents: timeline.events.length
        });
        return toolResult(timeline);
      } catch (error) {
        await audit.write("get_evidence_timeline_failed", {
          items,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  );
}
