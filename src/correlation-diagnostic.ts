import { AuditLog } from "./audit-log.js";
import { getConfig } from "./config.js";
import { IpedClient } from "./iped-client.js";
import { InvestigatorService } from "./investigator-service.js";
import { InvestigationSessions } from "./investigation-sessions.js";

const config = getConfig();
const audit = new AuditLog();
const iped = new IpedClient(config);
const sessions = new InvestigationSessions();
const investigator = new InvestigatorService(iped, sessions, audit);

const question = process.argv.slice(2).join(" ").trim() ||
  "Investigue todas as evidências relacionadas a Carlos";
const started = await investigator.begin(question);
const investigationId = started.workspace?.investigationId;
if (!investigationId) throw new Error("Investigation did not start.");

const open = sessions.get(investigationId)?.leads.find(item => item.status === "OPEN");
if (!open) throw new Error("No open correlation was produced by the initial investigation.");

const expanded = await investigator.exploreLead(investigationId, open.type, open.value);
const diagnostic = [...audit.entries()].reverse()
  .find(entry => entry.action === "context_correlation_diagnostics");

console.log(JSON.stringify({
  question,
  investigationId,
  selectedCorrelation: { type: open.type, value: open.value },
  initialEvidence: started.workspace?.panels?.evidence?.map((item: any) => ({
    sourceId: item.sourceId, itemId: item.itemId, name: item.name
  })),
  expansionStatus: expanded.status,
  finalEvidence: "workspace" in expanded
    ? expanded.workspace?.panels?.evidence?.map((item: any) => ({
        sourceId: item.sourceId, itemId: item.itemId, name: item.name
      }))
    : undefined,
  diagnostic
}, null, 2));
