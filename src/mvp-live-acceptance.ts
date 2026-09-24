import { AuditLog } from "./audit-log.js";
import { getConfig } from "./config.js";
import { IpedClient } from "./iped-client.js";
import { InvestigationSessions } from "./investigation-sessions.js";
import { InvestigatorService } from "./investigator-service.js";

const config = getConfig();
const audit = new AuditLog();
const sessions = new InvestigationSessions();
const service = new InvestigatorService(new IpedClient(config), sessions, audit);
const started = await service.begin("Investigue todas as evidências relacionadas a Carlos", "mcp-lab");
const investigationId = started.workspace?.investigationId;
if (!investigationId) throw new Error("MVP live acceptance failed: investigation did not start");
const ambiguities = started.workspace?.panels.retrievalAmbiguities ?? [];
const carlosAmbiguity = ambiguities.find((group: any) =>
  group.candidates?.some((candidate: any) => candidate.value === "Carlos Almeida") &&
  group.candidates?.some((candidate: any) => candidate.value === "Carlos Santos")
);
if (!carlosAmbiguity) {
  throw new Error("MVP live acceptance failed: broad Carlos retrieval did not surface distinct identities");
}
const lead = sessions.get(investigationId)?.leads.find(
  item => item.status === "OPEN" && item.type === "MONEY" && item.value === "18.750,00"
);
if (!lead) throw new Error("MVP live acceptance failed: expected monetary correlation not found");
const expanded = await service.exploreLead(investigationId, lead.type, lead.value);
if (!("workspace" in expanded) || !expanded.workspace) {
  throw new Error(`MVP live acceptance failed: ${expanded.status}`);
}
const ids = new Set(expanded.workspace.panels.evidence.map((item: any) => item.itemId));
const diagnostic: any = [...audit.entries()].reverse().find(
  entry => entry.action === "context_correlation_diagnostics"
);
const divergent = diagnostic?.candidates?.find(
  (candidate: any) => candidate.evidence === "mcp-lab:2"
);
if (!ids.has(2) || divergent?.accepted !== true || divergent.reason !== "SHARES_ESTABLISHED_CONTEXT") {
  throw new Error("MVP live acceptance failed: contextual divergent evidence was not admitted");
}
const textContexts = (diagnostic?.extractedContext ?? []).filter(
  (item: any) => item.type === "TEXT_PHRASE"
);
if (textContexts.some((item: any) => item.value.includes("\n"))) {
  throw new Error("MVP live acceptance failed: textual context crossed evidence field boundaries");
}
console.log(JSON.stringify({
  status: "MVP_LIVE_ACCEPTANCE_PASSED",
  initialEvidenceCount: started.workspace?.panels.evidence.length,
  finalEvidenceCount: expanded.workspace.panels.evidence.length,
  retrievalAmbiguity: carlosAmbiguity.candidates.map((candidate: any) => candidate.value),
  divergentEvidence: "mcp-lab:2",
  divergentReason: divergent.reason,
  textContexts: textContexts.map((item: any) => item.value)
}, null, 2));
