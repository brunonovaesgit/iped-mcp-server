import { config } from "./config.js";
import { AuditLog } from "./audit-log.js";
import { IpedClient } from "./iped-client.js";
import { InvestigationSessions } from "./investigation-session.js";
import { InvestigatorService } from "./investigator-service.js";

const iped = new IpedClient(config.ipedUrl);
const audit = new AuditLog();
const service = new InvestigatorService(iped, new InvestigationSessions(), audit);
const started = await service.begin("Investigue todas as evidências relacionadas a Carlos", "mcp-lab");
if (started.status !== "INVESTIGATION_READY") throw new Error(`MVP live acceptance failed: ${started.status}`);
const lead = started.workspace.panels.correlations.find(item => item.type === "MONEY" && item.value === "18.750,00");
if (!lead) throw new Error("MVP live acceptance failed: expected monetary correlation not found");
const expanded = await service.exploreLead(started.workspace.investigationId, lead.type, lead.value);
const ids = new Set(expanded.workspace.panels.evidence.map(item => item.itemId));
const diagnostic = [...audit.entries()].find(entry => entry.action === "context_correlation_diagnostics");
const divergent = diagnostic?.candidates?.find(candidate => candidate.evidence === "mcp-lab:2");
if (!ids.has(2) || divergent?.accepted !== true || divergent.reason !== "SHARES_ESTABLISHED_CONTEXT") {
  throw new Error("MVP live acceptance failed: contextual divergent evidence was not admitted");
}
const textContexts = diagnostic?.extractedContext?.filter(item => item.type === "TEXT_PHRASE") ?? [];
if (textContexts.some(item => item.value.includes("\n"))) {
  throw new Error("MVP live acceptance failed: textual context crossed evidence field boundaries");
}
console.log(JSON.stringify({
  status: "MVP_LIVE_ACCEPTANCE_PASSED",
  initialEvidenceCount: started.workspace.panels.evidence.length,
  finalEvidenceCount: expanded.workspace.panels.evidence.length,
  divergentEvidence: "mcp-lab:2",
  divergentReason: divergent.reason,
  textContexts: textContexts.map(item => item.value)
}, null, 2));
