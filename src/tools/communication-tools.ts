import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../tool-context.js";
import { toolResult } from "../tool-context.js";

export function registerCommunicationTools(
  server: McpServer,
  { iped, audit }: ToolContext
): void {
  server.tool(
    "get_communication_participants",
    "Read sender, recipient and conversation participant metadata indexed by IPED for a communication evidence item. The returned metadata describes what IPED extracted and does not by itself establish real-world identity.",
    {
      sourceId: z.string().min(1),
      itemId: z.number().int().nonnegative()
    },
    async ({ sourceId, itemId }) => {
      try {
        const participants = await iped.getCommunicationParticipants(
          sourceId,
          itemId
        );

        await audit.write("get_communication_participants", {
          sourceId,
          itemId,
          participants
        });

        return toolResult(participants);
      } catch (error) {
        await audit.write("get_communication_participants_failed", {
          sourceId,
          itemId,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  );

  server.tool(
    "get_communication_network",
    "Build a communication network from selected IPED evidence items using sender, recipient and conversation metadata extracted by IPED. The network describes participants observed in the evidence and does not by itself establish real-world identity.",
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
        const network = await iped.getCommunicationNetwork(items);

        await audit.write("get_communication_network", {
          items,
          communicationCount: network.communications.length,
          participantCount: network.participants.length
        });

        return toolResult(network);
      } catch (error) {
        await audit.write("get_communication_network_failed", {
          items,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  );

  server.tool(
    "investigate_communications",
    "Investigate communications related to a person, organization, email address, phone number or other search term. Finds matching IPED evidence and builds the communication network observed in sender, recipient and conversation metadata. Matching evidence and participants do not by themselves establish real-world identity.",
    {
      query: z.string().min(1),
      sourceId: z.string().optional(),
      limit: z.number().int().positive().max(100).optional()
    },
    async ({ query, sourceId, limit }) => {
      try {
        const investigation = await iped.investigateCommunications(
          query,
          sourceId,
          limit
        );

        await audit.write("investigate_communications", {
          query,
          sourceId,
          matchedEvidence: investigation.matchedEvidence,
          matchedEvidenceTruncated:
            investigation.matchedEvidenceTruncated,
          communicationCount: investigation.communications.length,
          participantCount: investigation.participants.length
        });

        return toolResult(investigation);
      } catch (error) {
        await audit.write("investigate_communications_failed", {
          query,
          sourceId,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  );
}
