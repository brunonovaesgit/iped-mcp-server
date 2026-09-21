import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../tool-context.js";
import { toolResult } from "../tool-context.js";

export function registerEvidenceTools(
  server: McpServer,
  { iped, audit }: ToolContext
): void {
  server.tool(
    "get_evidence",
    "Read the indexed metadata for one evidence item.",
    {
      sourceId: z.string().min(1),
      itemId: z.number().int().nonnegative()
    },
    async ({ sourceId, itemId }) => {
      try {
        const evidence = await iped.getEvidence(sourceId, itemId);
        await audit.write("get_evidence", { sourceId, itemId });
        return toolResult(evidence);
      } catch (error) {
        await audit.write("get_evidence_failed", {
          sourceId,
          itemId,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  );

  server.tool(
    "get_evidence_text",
    "Read the text extracted by IPED for one evidence item.",
    {
      sourceId: z.string().min(1),
      itemId: z.number().int().nonnegative()
    },
    async ({ sourceId, itemId }) => {
      try {
        const evidence = await iped.getText(sourceId, itemId);
        await audit.write("get_evidence_text", {
          sourceId,
          itemId,
          returnedCharacters: evidence.text.length,
          truncated: evidence.truncated
        });
        return toolResult(evidence);
      } catch (error) {
        await audit.write("get_evidence_text_failed", {
          sourceId,
          itemId,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  );

  server.tool(
    "get_evidence_entities",
    "Read structured values already extracted and indexed by IPED for an evidence item. Each entity includes a searchQuery that can be passed directly to search_evidence to find the same indexed value elsewhere in the case. A repeated value is a lead for investigation, not by itself proof of identity or relationship.",
    {
      sourceId: z.string().min(1),
      itemId: z.number().int().nonnegative()
    },
    async ({ sourceId, itemId }) => {
      try {
        const entities = await iped.getEvidenceEntities(sourceId, itemId);
        await audit.write("get_evidence_entities", {
          sourceId,
          itemId,
          entities: entities.entities
        });
        return toolResult(entities);
      } catch (error) {
        await audit.write("get_evidence_entities_failed", {
          sourceId,
          itemId,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  );

  server.tool(
    "get_evidence_content",
    "Read the original file associated with an IPED evidence item. Use this when the original artifact is needed instead of only its extracted text.",
    {
      sourceId: z.string().min(1),
      itemId: z.number().int().nonnegative()
    },
    async ({ sourceId, itemId }) => {
      try {
        const evidence = await iped.getContent(sourceId, itemId);
        await audit.write("get_evidence_content", {
          sourceId,
          itemId,
          filename: evidence.filename,
          mimeType: evidence.mimeType,
          size: evidence.size
        });

        return {
          content: [
            {
              type: "resource" as const,
              resource: {
                uri: `iped://evidence/${encodeURIComponent(sourceId)}/${itemId}/content`,
                mimeType: evidence.mimeType,
                blob: evidence.data
              }
            }
          ]
        };
      } catch (error) {
        await audit.write("get_evidence_content_failed", {
          sourceId,
          itemId,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  );

  server.tool(
    "get_related_evidence",
    "Find evidence structurally related to an IPED item, including its parent, children and other items with the same hash. Check the truncation flags before assuming the returned relationships are complete.",
    {
      sourceId: z.string().min(1),
      itemId: z.number().int().nonnegative()
    },
    async ({ sourceId, itemId }) => {
      try {
        const related = await iped.getRelatedEvidence(sourceId, itemId);
        await audit.write("get_related_evidence", {
          sourceId,
          itemId,
          parent: related.parent,
          children: related.children,
          childrenTruncated: related.childrenTruncated,
          sameHash: related.sameHash,
          sameHashTruncated: related.sameHashTruncated
        });
        return toolResult(related);
      } catch (error) {
        await audit.write("get_related_evidence_failed", {
          sourceId,
          itemId,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  );

  server.tool(
    "inspect_evidence",
    "Inspect an IPED evidence item in one step, returning its indexed metadata, extracted text, structured values and structural relationships. Use this as the primary tool when an investigation needs to understand an evidence item in detail.",
    {
      sourceId: z.string().min(1),
      itemId: z.number().int().nonnegative()
    },
    async ({ sourceId, itemId }) => {
      try {
        const inspection = await iped.inspectEvidence(sourceId, itemId);
        await audit.write("inspect_evidence", {
          sourceId,
          itemId,
          textCharacters: inspection.text.text.length,
          textTruncated: inspection.text.truncated,
          entities: inspection.entities.length,
          children: inspection.related.children.length,
          childrenTruncated: inspection.related.childrenTruncated,
          sameHash: inspection.related.sameHash.length,
          sameHashTruncated: inspection.related.sameHashTruncated
        });
        return toolResult(inspection);
      } catch (error) {
        await audit.write("inspect_evidence_failed", {
          sourceId,
          itemId,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  );

  server.tool(
    "follow_evidence_leads",
    "Follow structured values already extracted by IPED from an evidence item and find where the same indexed values appear elsewhere in the case. Matching values are investigative leads and must not be treated by themselves as proof of identity, relationship or corroboration.",
    {
      sourceId: z.string().min(1),
      itemId: z.number().int().nonnegative()
    },
    async ({ sourceId, itemId }) => {
      try {
        const investigation = await iped.followEvidenceLeads(sourceId, itemId);
        await audit.write("follow_evidence_leads", {
          sourceId,
          itemId,
          leads: investigation.leads.map(lead => ({
            type: lead.type,
            value: lead.value,
            matches: lead.matches.length,
            truncated: lead.truncated
          }))
        });
        return toolResult(investigation);
      } catch (error) {
        await audit.write("follow_evidence_leads_failed", {
          sourceId,
          itemId,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  );

  server.tool(
    "get_evidence_connections",
    "Find other evidence items that share structured values indexed by IPED with an origin item. Shared values are investigative connections, not proof that records refer to the same person, organization or event.",
    {
      sourceId: z.string().min(1),
      itemId: z.number().int().nonnegative()
    },
    async ({ sourceId, itemId }) => {
      try {
        const connections = await iped.getEvidenceConnections(sourceId, itemId);
        await audit.write("get_evidence_connections", {
          sourceId,
          itemId,
          connections: connections.connections
        });
        return toolResult(connections);
      } catch (error) {
        await audit.write("get_evidence_connections_failed", {
          sourceId,
          itemId,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  );
}
