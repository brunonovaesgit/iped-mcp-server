import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../tool-context.js";
import { toolResult } from "../tool-context.js";

export function registerGovernanceTools(
  server: McpServer,
  { iped, audit }: ToolContext
): void {
  server.tool(
    "check_claim_evidence",
    "Check the evidence references used to support an investigative claim. Verifies that referenced IPED items exist and identifies same-hash duplicates that must not be counted as independent corroboration. This structural check does not determine whether the evidence semantically proves the claim.",
    {
      classification: z.enum(["FACT", "INFERENCE", "HYPOTHESIS"]),
      claim: z.string().min(1),
      evidence: z.array(
        z.object({
          sourceId: z.string().min(1),
          itemId: z.number().int().nonnegative()
        })
      ).min(1).max(100)
    },
    async ({ classification, claim, evidence }) => {
      try {
        const validation = await iped.checkClaimEvidence(
          classification,
          claim,
          evidence
        );

        await audit.write("check_claim_evidence", {
          classification,
          claim,
          evidence,
          referencesVerified: validation.referencesVerified,
          duplicateGroups: validation.duplicateGroups,
          independentEvidenceCount: validation.independentEvidenceCount
        });

        return toolResult(validation);
      } catch (error) {
        await audit.write("check_claim_evidence_failed", {
          classification,
          claim,
          evidence,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  );

  server.tool(
    "build_evidence_ledger",
    "Build a structured ledger of investigative claims before presenting conclusions. Facts must distinguish statements contained in evidence from directly observed metadata. The ledger verifies evidence references and same-hash duplicates but does not determine semantic truth.",
    {
      claims: z.array(
        z.object({
          classification: z.enum(["FACT", "INFERENCE", "HYPOTHESIS"]),
          statement: z.string().min(1),
          factBasis: z.enum([
            "DOCUMENT_STATEMENT",
            "OBSERVED_METADATA"
          ]).optional(),
          evidence: z.array(
            z.object({
              sourceId: z.string().min(1),
              itemId: z.number().int().nonnegative()
            })
          ).min(1).max(100),
          limitation: z.string().min(1).optional()
        })
      ).min(1).max(100)
    },
    async ({ claims }) => {
      try {
        const ledger = await iped.buildEvidenceLedger(claims);

        await audit.write("build_evidence_ledger", {
          entries: ledger.entries.map(entry => ({
            classification: entry.classification,
            statement: entry.statement,
            factBasis: entry.factBasis,
            evidence: entry.evidence,
            referencesVerified: entry.referencesVerified,
            duplicateGroups: entry.duplicateGroups,
            independentEvidenceCount: entry.independentEvidenceCount
          }))
        });

        return toolResult(ledger);
      } catch (error) {
        await audit.write("build_evidence_ledger_failed", {
          claims,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  );
}
