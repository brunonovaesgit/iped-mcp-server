import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { AuditLog } from "./audit-log.js";
import { getConfig } from "./config.js";
import { IpedClient } from "./iped-client.js";
import { InvestigatorService } from "./investigator-service.js";
import { InvestigationSessions } from "./investigation-sessions.js";
import { createAiAnalyzer } from "./ai-analyzer.js";
import { BookmarkConflictError, BookmarkInputError, ExaminerBookmarks } from "./examiner-bookmarks.js";
import { InvestigationStore, NoteInputError, isInvestigationId } from "./investigation-store.js";
import { CaseEventInputError, missingEventEvidence, normalizeEventInput } from "./case-events.js";
import { ClaimInputError, normalizeClaimInput, verifyClaim, type Claim } from "./claims.js";
import { buildReportHtml, collectReferences, type ReportAuditEntry, type ReportEvidence } from "./report.js";
import { readFile } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import { DisabledAiAnalyzer, type AiAnalyzer } from "./ai-analyzer.js";

const config = getConfig();
const audit = new AuditLog(config.auditLog);
const iped = new IpedClient(config);
const investigations = new InvestigationSessions();
const baseAi = createAiAnalyzer({
  baseUrl: config.aiBaseUrl,
  model: config.aiModel,
  apiKey: config.aiApiKey
});

/** Live progress of a running request. Holds counters and a phase label only, never case content. */
export type ProgressState = {
  phase: string;
  searches: number;
  itemsRead: number;
  startedAt: number;
  updatedAt: number;
  done?: boolean;
};
const progressStore = new AsyncLocalStorage<ProgressState>();
const progress = new Map<string, ProgressState>();
const PROGRESS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function classifyIpedPath(path: string): "search" | "item" | "other" {
  if (path.endsWith("/search")) return "search";
  if (path.includes("/docs/")) return "item";
  return "other";
}

iped.onRequest = (path) => {
  const state = progressStore.getStore();
  if (!state) return;
  const kind = classifyIpedPath(path);
  if (kind === "search") { state.searches++; state.phase = "Buscando no índice do IPED"; }
  else if (kind === "item") { state.itemsRead++; state.phase = "Lendo evidências"; }
  state.updatedAt = Date.now();
};

const ai: AiAnalyzer = {
  async analyze(input) {
    const state = progressStore.getStore();
    if (state && !(baseAi instanceof DisabledAiAnalyzer)) {
      state.phase = "Análise assistida por IA (pode levar alguns minutos)";
      state.updatedAt = Date.now();
    }
    return baseAi.analyze(input);
  }
};

function trackProgress<T>(request: IncomingMessage, work: () => Promise<T>): Promise<T> {
  const header = request.headers["x-progress-id"];
  const id = typeof header === "string" && PROGRESS_ID.test(header) ? header.toLowerCase() : undefined;
  if (!id) return work();
  const now = Date.now();
  const state: ProgressState = { phase: "Preparando a investigação", searches: 0, itemsRead: 0, startedAt: now, updatedAt: now };
  progress.set(id, state);
  for (const [key, value] of progress) if (now - value.updatedAt > 10 * 60_000) progress.delete(key);
  return progressStore.run(state, async () => {
    try { return await work(); }
    finally {
      state.done = true; state.phase = "Concluído"; state.updatedAt = Date.now();
      setTimeout(() => progress.delete(id), 60_000).unref();
    }
  });
}
const investigator = new InvestigatorService(iped, investigations, audit, ai);
const examinerBookmarks = new ExaminerBookmarks(config, audit);
const investigationStore = new InvestigationStore(config.investigationsDir);

/** Saves the investigation after each result. Persistence never blocks the answer. */
async function persist<T>(result: T): Promise<T> {
  const id = (result as { workspace?: { investigationId?: unknown } })?.workspace?.investigationId;
  if (typeof id !== "string") return result;
  const state = investigations.get(id);
  if (!state) return result;
  try {
    await investigationStore.save(state, (result as { workspace: unknown }).workspace);
  } catch (error) {
    await audit.write("investigation_persist_failed", {
      investigationId: id,
      error: error instanceof Error ? error.message : String(error)
    });
  }
  return result;
}
const port = Number(process.env.INVESTIGATOR_PORT ?? 3333);
export const investigatorHtml = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>IPED MCP</title>
  <style>
    :root{
      --ink:#17202a;--muted:#5d6773;--subtle:#68727e;
      --border:#dfe4ea;--border-soft:#edf0f3;--border-strong:#c7cfd8;
      --surface:#fff;--surface-alt:#f7f9fb;--page:#f4f6f8;
      --accent:#263b50;--accent-strong:#17202a;--accent-soft:#eef2f7;--accent-soft-hover:#e2e9f0;
      --space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:24px;--space-6:32px;
      --radius-sm:8px;--radius-md:12px;--radius-lg:16px;
      --shadow-sm:0 1px 2px rgba(23,32,42,.05),0 1px 1px rgba(23,32,42,.04);
      --shadow-md:0 12px 28px rgba(23,32,42,.09),0 2px 6px rgba(23,32,42,.06);
      font-family:Inter,system-ui,-apple-system,sans-serif;color:var(--ink);background:var(--page)
    }
    *{box-sizing:border-box} html,body{height:100%} body{margin:0;display:flex;flex-direction:column;overflow:hidden} button,input,select{font:inherit}
    header{background:var(--accent-strong);color:white;padding:var(--space-4) var(--space-6);display:flex;justify-content:space-between;align-items:center;box-shadow:var(--shadow-sm);flex-shrink:0}
    header strong{font-size:18px;letter-spacing:.2px} #connection{font-size:13px;color:#a9b6c4}
    .appBody{display:flex;flex:1;min-height:0}
    .sidebar{width:400px;flex-shrink:0;display:flex;flex-direction:column;min-height:0;background:var(--surface);border-right:1px solid var(--border);overflow-x:hidden;overflow-wrap:anywhere}
    .sidebar *{min-width:0}
    .sidebarTop{padding:var(--space-5);border-bottom:1px solid var(--border);flex-shrink:0}
    .sidebarScroll{flex:1;overflow-y:auto;overflow-x:hidden;padding:var(--space-4) var(--space-5) var(--space-5)}
    .mainArea{flex:1;display:flex;flex-direction:column;min-height:0}
    #workspaceMain{display:flex;flex-direction:column;min-height:0;flex:1}
    #workspaceMain.hidden{display:none}
    .tabBar{display:flex;gap:var(--space-2);padding:0 var(--space-5);background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0}
    .tabButton{background:none;border:0;border-radius:0;border-bottom:3px solid transparent;padding:14px 6px;font-size:14px;font-weight:600;color:var(--muted)}
    .tabButton:hover{background:none;color:var(--accent-strong)}
    .tabButton.tabActive{border-bottom-color:var(--accent);color:var(--accent-strong)}
    .tabCount{font-size:11px;background:var(--surface-alt);color:var(--subtle);border-radius:999px;padding:2px 7px;font-weight:600;margin-left:6px}
    .tabContent{flex:1;overflow-y:auto;padding:var(--space-5) var(--space-6)}
    .tabPanel+.tabPanel{margin-top:var(--space-5)}
    .hero{padding:0} .hero h1{margin:0 0 4px;font-size:17px;letter-spacing:-.1px}.hero p{margin:0;color:var(--muted);font-size:12.5px}
    .panel{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:var(--space-5);box-shadow:var(--shadow-sm)}
    form{display:flex;gap:var(--space-2);margin-top:var(--space-4)} input,select{font:inherit;padding:13px 15px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--surface)} input{flex:1}
    textarea{font:inherit;width:100%;resize:vertical;padding:13px 15px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--surface);color:var(--ink);line-height:1.5}
    textarea:focus,input:focus{outline:3px solid var(--accent-soft-hover);outline-offset:0;border-color:var(--accent)}
    .askForm{flex-direction:column;align-items:stretch}
    #question{min-height:132px;max-height:45vh}#followUp{min-height:76px;max-height:30vh}
    .askActions{display:flex;justify-content:space-between;align-items:center;gap:var(--space-3)}.askHint{font-size:12px;color:var(--subtle)}
    #followUpForm{margin:0 0 var(--space-5)}
    .questionCard{background:var(--surface);border:1px solid var(--border);border-left:4px solid var(--accent);border-radius:var(--radius-md);padding:var(--space-4) var(--space-5);margin-bottom:var(--space-5);box-shadow:var(--shadow-sm)}
    .questionCard .label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--subtle);margin-bottom:6px}.questionCard p{margin:0;font-size:15px;line-height:1.55;white-space:pre-wrap}
    body.landing .sidebar,body.landing #mainEmptyState{display:none}
    .landingSlot{display:none}body.landing .landingSlot{display:block;width:min(760px,92vw);margin:auto;padding:var(--space-6) 0}
    body.landing .hero h1{font-size:30px;font-weight:650;letter-spacing:-.4px;text-align:center;margin:0 0 10px}
    body.landing .hero>p{text-align:center;font-size:15px;margin:0 0 var(--space-5)}
    body.landing #question{min-height:150px;font-size:16px;padding:18px 20px;border-radius:var(--radius-lg);box-shadow:var(--shadow-md)}
    body.landing .status{text-align:center;min-height:20px}
    .landingNote{display:none}body.landing .landingNote{display:block;text-align:center;font-size:12.5px;color:var(--subtle);margin-top:var(--space-4)}
    .mainEmpty{margin:auto;max-width:560px;text-align:center;padding:var(--space-6);color:var(--subtle);font-size:15px;line-height:1.6}
    .caseBar{display:flex;gap:var(--space-3);align-items:center;margin-top:var(--space-4);padding:var(--space-3) var(--space-4);background:var(--surface-alt);border-radius:var(--radius-sm)}.caseBar label{font-size:13px;color:var(--muted)}.caseBar select{padding:8px 10px}
    button{border:0;border-radius:var(--radius-sm);padding:12px 18px;background:var(--accent-soft);color:var(--accent-strong);cursor:pointer;font-weight:600;transition:background .12s ease}
    button:hover{background:var(--accent-soft-hover)}
    @keyframes pulse{0%,100%{opacity:.45}50%{opacity:.85}}
    button:disabled{opacity:.5;cursor:not-allowed;animation:pulse 1.1s ease-in-out infinite}
    .status{margin-top:var(--space-3);font-size:14px;color:var(--muted)}
    .newEvidence{background:var(--accent-soft);border-radius:var(--radius-sm);margin:0 -10px;padding-left:10px;padding-right:10px}
    #startButton{background:var(--accent);color:white;padding:14px 22px;font-size:15px;box-shadow:var(--shadow-sm)}
    #startButton:hover{background:var(--accent-strong)}
    .leadButton,.graphToolbar button{background:transparent;color:var(--accent);border:1px solid var(--border-strong);font-weight:600}
    .leadButton:hover,.graphToolbar button:hover{background:var(--accent-soft)}
    .analysis{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:var(--space-5);margin:var(--space-5) 0;box-shadow:var(--shadow-sm)}.analysis h2{margin:0 0 10px;font-size:18px}.analysis p{line-height:1.55}.analysis .observation{border-top:1px solid var(--border-soft);padding:var(--space-3) 0}.analysis .observation:first-of-type{border-top:0}
    .summary{display:grid;grid-template-columns:repeat(2,1fr);gap:var(--space-3);margin-bottom:var(--space-5)}
    .metric{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-3);box-shadow:var(--shadow-sm)}.metric b{display:block;font-size:20px;color:var(--accent-strong)}.metric span{font-size:11px;color:var(--subtle);text-transform:uppercase;letter-spacing:.4px}
    .panel h2{margin-top:0;font-size:14px;text-transform:uppercase;letter-spacing:.4px;color:var(--subtle)}
    .panel+.panel{margin-top:var(--space-4)}
    .item{border-top:1px solid var(--border-soft);padding:var(--space-3) 0}.item:first-of-type{border-top:0}
    .meta{font-size:12px;color:var(--subtle)}.lead{display:flex;flex-wrap:wrap;justify-content:space-between;gap:var(--space-2) var(--space-3);align-items:center}
    .badge{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;padding:3px 8px;border-radius:999px;background:var(--surface-alt);color:var(--subtle)}
    .graphToolbar{display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap;margin-top:var(--space-3)}.graphToolbar button,.graphToolbar select{padding:7px 10px;font-size:12px}.graphToolbar select{border-radius:var(--radius-sm)}.graphToolbar .meta{margin-right:auto}
    .graphShell{position:relative;margin-top:10px}.graph{position:relative;min-height:520px;overflow:auto;border:1px solid var(--border-soft);border-radius:var(--radius-md);background:var(--surface)}
    .graph svg{display:block}.graphMiniMap{position:absolute;left:12px;bottom:12px;z-index:4;width:180px;height:110px;border:1px solid var(--border);border-radius:7px;background:var(--surface);box-shadow:var(--shadow-md);overflow:hidden;cursor:crosshair}.graphMiniMap svg{width:100%;height:100%}.graphMiniMap circle{fill:#7a8490;opacity:.7}.graphMiniMap .miniViewport{fill:none;stroke:var(--accent);stroke-width:8;vector-effect:non-scaling-stroke;pointer-events:none}.graphShell.fullscreen{position:fixed;inset:16px;z-index:40;background:var(--surface);box-shadow:0 10px 50px #0005;border-radius:var(--radius-md)}.graphShell.fullscreen .graph{height:100%;max-height:none;margin:0}.graphShell.fullscreen .graph svg{min-width:100%}.graph line{stroke:#aeb8c2;stroke-width:1.4}.graph text{font-size:11px;fill:#26323d}.graph .laneLabel{font-size:12px;font-weight:700;fill:var(--subtle)}
    .graph .node{cursor:pointer}.graph .node circle{fill:white;stroke:#52677b;stroke-width:2}.graph .node.evidence circle{stroke:var(--accent)}.graph .node.communication circle{stroke:var(--subtle)}
    .graph .edge{cursor:pointer}.graph .edge:hover{stroke-width:3}.graphDetail{margin-top:10px;padding:var(--space-3);background:var(--surface-alt);border-radius:7px;font-size:12px}
    .evidenceButton{background:none;color:var(--accent);padding:0;text-align:left;font-weight:700}.evidenceButton:hover{text-decoration:underline;background:none}
    .drawer{position:fixed;top:0;right:0;width:min(620px,92vw);height:100vh;background:var(--surface);border-left:1px solid var(--border);box-shadow:-8px 0 30px #0002;padding:var(--space-5);overflow:auto;z-index:20}
    .drawerHeader{display:flex;justify-content:space-between;gap:var(--space-4);align-items:start}.drawerHeader button{padding:7px 11px}.evidenceText{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;line-height:1.5;background:var(--surface-alt);padding:14px;border-radius:var(--radius-sm);max-height:46vh;overflow:auto}.property{padding:7px 0;border-top:1px solid var(--border-soft)}
    .empty{color:var(--subtle);font-size:14px}.hidden{display:none}

    .bookmarkBox{margin:16px 0 4px;padding:14px 16px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface-alt)}
    .bookmarkHead{display:flex;flex-direction:column;gap:2px;margin-bottom:10px}.bookmarkBox h3{margin:0;font-size:14px}
    .chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
    .chip{display:inline-flex;align-items:center;gap:2px;background:var(--surface);border:1px solid var(--border-strong);border-radius:999px;padding:3px 4px 3px 10px;font-size:12.5px;font-weight:600}
    .chipRemove{background:none;padding:0 6px;color:var(--subtle);font-size:15px;line-height:1;font-weight:500}.chipRemove:hover{background:var(--accent-soft);color:var(--ink)}
    .bookmarkForm{display:flex;gap:8px;margin:0}.bookmarkForm input{flex:1;padding:9px 12px}.bookmarkForm button{background:var(--accent);color:#fff;padding:9px 16px}.bookmarkForm button:hover{background:var(--accent-strong)}
    #bookmarkStatus{margin-top:8px;min-height:16px}.bookmarkWarning{color:#8a5a12;margin-top:4px}
    .noteForm{flex-direction:column;align-items:stretch;margin:12px 0 6px}#noteText{min-height:96px;max-height:40vh}
    .note{border-top:1px solid var(--border-soft);padding:14px 0}.note:first-child{border-top:0}
    .noteMeta{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:12px;color:var(--subtle);margin-bottom:6px}
    .noteBody{white-space:pre-wrap;line-height:1.6;font-size:14.5px;overflow-wrap:anywhere}.noteBody .evidenceButton{display:inline;font-size:inherit}
    .linkBtn{background:none;padding:2px 6px;color:var(--accent);font-weight:600;font-size:12px}.linkBtn:hover{background:var(--accent-soft)}.noteActions{display:inline-flex;gap:4px}
    .drawerActions{display:flex;gap:8px}.drawerActions button{padding:7px 11px}#citeEvidence{background:var(--accent);color:#fff}#citeEvidence:hover{background:var(--accent-strong)}
    #noteSubmit{background:var(--accent);color:#fff}#noteSubmit:hover{background:var(--accent-strong)}
    @media(max-width:800px){form.composer,form.bookmarkForm{flex-direction:row}}
    .claimForm{flex-direction:column;align-items:stretch;gap:10px;margin:12px 0 6px}.claimForm label{display:flex;flex-direction:column;gap:4px;font-size:12.5px;font-weight:600;color:var(--muted)}
    .claimForm input,.claimForm select,.claimForm textarea{font-weight:400;color:var(--ink)}.claimRow{display:flex;gap:12px;flex-wrap:wrap}.claimRow label{flex:1;min-width:180px}
    #claimSubmit{background:var(--accent);color:#fff}#claimSubmit:hover{background:var(--accent-strong)}
    .claimGroup{margin-top:18px}.claimGroup h3{font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:var(--subtle);margin:0 0 4px}
    .claim{border:1px solid var(--border);border-radius:var(--radius-md);padding:14px 16px;margin-top:10px;background:var(--surface)}
    .claimHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.claimHead .noteActions{margin-left:auto}
    .claimBadge{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;padding:3px 9px;border-radius:999px}
    .claimBadge.FACT{background:#e5f4e4;color:#1f6b33}.claimBadge.INFERENCE{background:#e7f1fb;color:#1d5a91}.claimBadge.HYPOTHESIS{background:#f9eeda;color:#8a5a12}
    .claimStatement{margin:8px 0;font-size:15px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
    .claimRefs{font-size:13px;line-height:1.7}.claimRefs .evidenceButton{margin-right:8px}
    .claimForm label.checkLabel{flex-direction:row;align-items:center;gap:6px;flex:0 0 auto;min-width:0;align-self:flex-end;padding-bottom:9px}.checkLabel input{width:auto}
    .caseTimeline{list-style:none;margin:14px 0 0;padding:0 0 0 18px;border-left:2px solid var(--border)}.caseEvent{position:relative;padding:0 0 16px 14px}.caseEvent::before{content:"";position:absolute;left:-25px;top:4px;width:10px;height:10px;border-radius:50%;background:var(--accent);border:2px solid var(--surface)}
    .eventDate{font-weight:650;font-size:13px;margin-bottom:3px;font-variant-numeric:tabular-nums}.eventBody .noteActions{display:inline-flex;margin-top:4px}
    .claimCheck{margin-top:8px;font-size:12.5px;padding:8px 10px;border-radius:8px;background:var(--surface-alt)}.claimCheck.warn{background:#fdf4e3}
    .claimCheck ul{margin:6px 0 0;padding-left:18px}
    .missingRef{margin-right:8px;color:#a33a2a;text-decoration:line-through;font-weight:600;cursor:help}
    .exportBtn{margin-left:auto;font-size:13px;font-weight:600;color:var(--accent);text-decoration:none;border:1px solid var(--border-strong);border-radius:var(--radius-sm);padding:6px 12px}.exportBtn:hover{background:var(--accent-soft)}
    .previewCard{position:fixed;z-index:50;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);box-shadow:var(--shadow-md);padding:12px 14px;pointer-events:none;font-size:13px}
    .previewName{font-weight:700;margin-bottom:2px;overflow-wrap:anywhere}.previewChips{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}.previewChips .chip{padding:2px 8px;font-size:11.5px}
    .previewText{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,monospace;font-size:11.5px;line-height:1.45;background:var(--surface-alt);border-radius:6px;padding:8px;margin-top:6px;max-height:150px;overflow:hidden}.previewHint{margin-top:6px}
    /* ---- Conversational shell ---- */
    .shell{display:flex;height:100%;min-height:0}
    .nav{width:272px;flex-shrink:0;display:flex;flex-direction:column;background:#f9fafb;border-right:1px solid var(--border);transition:width .18s ease,margin .18s ease;overflow:hidden}
    body.navCollapsed .nav{width:0;border-right:0}
    .navTop{display:flex;align-items:center;justify-content:space-between;padding:14px 12px 10px 18px}
    .brand{font-weight:700;font-size:16px;letter-spacing:.1px;white-space:nowrap}
    .iconBtn{background:transparent;color:var(--muted);padding:7px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;line-height:0}
    .iconBtn:hover{background:var(--accent-soft);color:var(--ink)}
    .newBtn{margin:4px 12px 14px;display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);color:var(--ink);padding:10px 12px;font-weight:600;white-space:nowrap;box-shadow:var(--shadow-sm)}
    .newBtn:hover{background:var(--accent-soft)}
    .navSection{padding:6px 18px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--subtle);white-space:nowrap}
    .history{flex:1;overflow-y:auto;padding:2px 8px}
    .historyItem{display:block;width:100%;text-align:left;background:transparent;color:var(--ink);font-weight:500;font-size:13.5px;padding:9px 10px;border-radius:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .historyItem:hover{background:var(--accent-soft)}.historyItem.active{background:var(--accent-soft-hover);font-weight:600}
    .historyEmpty{padding:8px 10px;font-size:13px;color:var(--subtle);white-space:nowrap}
    .navBottom{border-top:1px solid var(--border);padding:12px 16px 16px;display:flex;flex-direction:column;gap:10px}
    .navBottom .caseBar{margin:0;flex-direction:column;align-items:stretch;gap:6px;padding:0;background:none}
    .conn{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);white-space:nowrap}
    .dot{width:8px;height:8px;border-radius:50%;background:#b8c0c8;flex-shrink:0}.dot.ok{background:#2f9e5b}
    #connection{color:var(--muted);font-size:13px}
    .navNote{font-size:12px;color:var(--subtle);line-height:1.45}
    .mainCol{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--surface)}
    .topBar{height:52px;flex-shrink:0;display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid var(--border-soft)}
    .topTitle{font-weight:500;font-size:14px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #navOpen{display:none}body.navCollapsed #navOpen{display:inline-flex}
    .mainCol .mainArea{flex:1;overflow-y:auto;display:flex;flex-direction:column;min-height:0;background:var(--surface)}
    body.landing #workspaceMain,body.landing .composerDock{display:none!important}
    body:not(.landing) .landingSlot{display:none!important}
    body.landing .landingSlot{display:block;width:min(760px,92%);margin:auto;padding:var(--space-6) 0}
    .thread{width:min(940px,100%);margin:0 auto;padding:28px 24px 40px;display:flex;flex-direction:column;gap:22px}
    #workspaceMain.thread{flex:none}
    .userTurn{display:flex;flex-direction:column;align-items:flex-end;gap:10px}
    .bubble{max-width:82%;background:var(--accent-soft);color:var(--ink);padding:12px 16px;border-radius:18px 18px 4px 18px;font-size:15px;line-height:1.55;white-space:pre-wrap}
    .bubble .kicker{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--subtle);margin-bottom:4px}
    .answer{display:flex;flex-direction:column;gap:14px}
    .answerHead{display:flex;align-items:center;gap:10px;font-weight:600;font-size:14px}
    .avatar{min-width:28px;height:28px;padding:0 8px;border-radius:8px;letter-spacing:.3px;background:var(--accent-strong);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700}
    .thread .summary{display:flex;flex-wrap:wrap;gap:8px;margin:0}
    .thread .metric{display:inline-flex;align-items:baseline;gap:6px;padding:6px 12px;border-radius:999px;box-shadow:none;background:var(--surface-alt)}
    .thread .metric b{display:inline;font-size:14px}.thread .metric span{font-size:11px}
    .thread .tabBar{position:sticky;top:0;z-index:3;padding:0;margin:0;background:var(--surface)}
    .thread .tabContent{overflow:visible;padding:4px 0 0;flex:none}
    .thread .analysis{margin:0 0 var(--space-4)}
    .composerDock{flex-shrink:0;padding:10px 24px 18px;background:linear-gradient(to top,var(--surface) 70%,rgba(255,255,255,0))}
    .composerInner{width:min(940px,100%);margin:0 auto}
    .composer{display:flex;align-items:flex-end;gap:8px;margin:0;padding:8px 8px 8px 14px;border:1px solid var(--border-strong);border-radius:22px;background:var(--surface);box-shadow:var(--shadow-md)}
    .composer:focus-within{border-color:var(--accent)}
    .composer textarea{border:0;outline:0!important;box-shadow:none;padding:8px 4px;min-height:24px!important;max-height:30vh;resize:none;font-size:15px;background:transparent}
    .sendBtn{width:38px;height:38px;border-radius:50%;padding:0;background:var(--accent);color:#fff;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
    .sendBtn:hover{background:var(--accent-strong)}
    .dockMeta{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:6px 8px 0;font-size:12px;color:var(--subtle)}.dockMeta>span:last-child{white-space:nowrap;flex-shrink:0}#dockStatusSlot{min-width:0;flex:1}#dockStatusSlot .status{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .composerDock .status{margin:0;font-size:12.5px}
    @media(max-width:800px){.nav{position:fixed;left:0;top:0;bottom:0;z-index:30;box-shadow:var(--shadow-md)}.thread{padding:20px 14px 32px}.bubble{max-width:92%}}
    @media(max-width:800px){.appBody{flex-direction:column}.sidebar{width:100%;max-height:42vh;border-right:0;border-bottom:1px solid var(--border)}form{flex-direction:column}}
    @media print{header,.nav,.topBar,.composerDock,.hero,#followUpForm,.tabBar,.sidebarTop,.graphToolbar,.graphMiniMap,.drawer{display:none!important}body{display:block;height:auto;overflow:visible}.appBody{display:block}.sidebar{width:100%;border:0;overflow:visible}.mainArea{display:block}#workspaceMain{display:block!important}.tabContent{overflow:visible!important;height:auto!important}.tabPanel{display:block!important;margin:16px 0}.analysis,.panel,.metric{break-inside:avoid;border-color:#bbb}.graphShell,.graph{overflow:visible!important;height:auto!important;min-height:0!important}.graph svg{max-width:100%;height:auto}button{display:none!important}}
  </style>
</head>
<body class="landing">
<div class="shell">
  <aside class="nav" id="nav" aria-label="Menu lateral">
    <div class="navTop"><span class="brand">IPED MCP</span><button type="button" class="iconBtn" id="navToggle" title="Recolher menu" aria-label="Recolher menu"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg></button></div>
    <button type="button" class="newBtn" id="newInvestigation"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>Nova investigação</span></button>
    <div class="navSection">Investigações</div>
    <div class="history" id="history"><div class="historyEmpty">Nenhuma investigação ainda.</div></div>
    <div class="navBottom">
      <div id="caseBar" class="caseBar hidden"><label for="sourceSelect">Fonte do caso</label><select id="sourceSelect"></select></div>
      <div class="conn"><span class="dot" id="connDot"></span><span id="connection">Conectando ao IPED...</span></div>
      <div class="navNote">As investigações ficam salvas neste computador, separadas da evidência. No caso do IPED, só os marcadores podem ser alterados.</div>
    </div>
  </aside>
  <div class="mainCol">
    <div class="topBar"><button type="button" class="iconBtn" id="navOpen" title="Abrir menu" aria-label="Abrir menu"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg></button><span class="topTitle" id="topTitle">Nova investigação</span></div>
    <main class="mainArea" id="mainArea">
      <div class="landingSlot" id="landingSlot">
        <section class="hero">
          <h1>O que você quer investigar neste caso?</h1>
          <p>Descreva o fato, pessoa, organização, comunicação ou relação que deseja analisar.</p>
          <div id="onboarding" class="analysis hidden"><h2>Conectar ao seu IPED</h2><p>Seu caso continua no IPED. Para conectá-lo, use o comando <b>npm run connect:iped</b> descrito no README. Nenhuma evidência é enviada, importada ou modificada.</p></div>
          <form id="questionForm" class="askForm">
            <textarea id="question" rows="5" aria-label="Pergunta investigativa" placeholder="Escreva livremente, com o contexto que julgar útil. Ex.: investigue possíveis relações entre Carlos Almeida, Orion Tecnologia e pagamentos de R$ 18.750; identifique contradições e pontos que não podem ser confirmados."></textarea>
            <div class="askActions"><span class="askHint">⌘/Ctrl + Enter para investigar</span><button id="startButton">Investigar</button></div>
          </form>
          <div class="status" id="status"></div>
          <p class="landingNote">Seu caso permanece no IPED, com acesso somente leitura. Cada achado traz a referência da evidência de origem.</p>
        </section>
      </div>
      <div class="mainEmpty hidden" id="mainEmptyState"></div>
      <div id="workspaceMain" class="thread hidden">
        <div class="userTurn" id="questionCard"></div>
        <div class="answer">
          <div class="answerHead"><span class="avatar">IPED</span><span>Resultado da investigação</span><a id="exportReport" class="exportBtn" href="#" download title="Baixar um rascunho de relatório com afirmações, notas, evidências citadas e rastreabilidade">Exportar relatório</a></div>
          <div class="summary" id="summary"></div>
          <div class="tabBar">
            <button type="button" class="tabButton tabActive" data-tab="resumo">Resumo</button>
            <button type="button" class="tabButton" data-tab="evidence">Evidências</button>
            <button type="button" class="tabButton" data-tab="relationships">Relações</button>
            <button type="button" class="tabButton" data-tab="timeline" id="timelineTab">Timeline</button>
            <button type="button" class="tabButton" data-tab="notebook" id="notebookTab">Caderno</button>
            <button type="button" class="tabButton" data-tab="claims" id="claimsTab">Afirmações</button>
          </div>
          <div class="tabContent">
            <div class="tabPanel" data-tab-panel="resumo">
              <div class="analysis hidden" id="directAnswer"></div>
              <div class="analysis" id="analysis"></div>
              <div class="analysis hidden" id="retrievalAmbiguities"></div>
              <div class="analysis hidden" id="valueVariations"></div>
              <div class="analysis hidden" id="aiAnalysis"></div>
              <div class="panel"><h2>Correlações para explorar</h2><div id="leads"></div></div>
              <div class="panel"><h2>Achados observados</h2><div id="findings"></div></div>
            </div>
            <div class="tabPanel hidden" data-tab-panel="evidence">
              <div class="panel"><h2>Evidências</h2><div id="evidence"></div></div>
            </div>
            <div class="tabPanel hidden" data-tab-panel="relationships">
              <div class="panel"><h2>Relações</h2><div id="relationships"></div><div id="relationshipDetail"></div></div>
            </div>
            <div class="tabPanel hidden" data-tab-panel="timeline">
              <div class="panel">
                <h2>Linha do tempo do caso</h2>
                <p class="meta">Eventos datados pelo perito a partir do conteúdo das evidências, como a data de um contrato ou de uma reunião combinada numa mensagem. Cada evento cita os itens de onde a data foi lida.</p>
                <form id="eventForm" class="askForm claimForm">
                  <div class="claimRow">
                    <label>Data<input type="date" id="eventDate" min="1900-01-01" max="2200-12-31"></label>
                    <label>Hora (opcional)<input type="time" id="eventTime"></label>
                    <label class="checkLabel"><input type="checkbox" id="eventApproximate"> Data aproximada</label>
                  </div>
                  <label>Evento<textarea id="eventDescription" rows="2" maxlength="1000" placeholder="Ex.: Assinatura do contrato com o Projeto Atlas."></textarea></label>
                  <label>Evidências<input id="eventEvidence" autocomplete="off" placeholder="Ex.: resultado:4"></label>
                  <div class="askActions"><button type="button" id="eventCancel" class="linkBtn hidden">Cancelar edição</button><button id="eventSubmit">Registrar evento</button></div>
                </form>
                <div id="eventStatus" class="meta"></div>
                <div id="eventsList"></div>
              </div>
              <div class="panel"><h2>Datas de arquivos e metadados</h2><p class="meta">Datas registradas pelo sistema de arquivos ou nos metadados (criação, modificação, envio). Indicam quando o arquivo foi gravado ou alterado, não necessariamente quando o fato descrito ocorreu.</p><div id="timeline"></div></div>
            </div>
            <div class="tabPanel hidden" data-tab-panel="notebook">
              <div class="panel">
                <h2>Caderno de análise</h2>
                <p class="meta">Anotações do perito, salvas com esta investigação e separadas da evidência. Referências no formato fonte:item, como a que o botão "Citar no caderno" insere, viram links para a evidência.</p>
                <form id="noteForm" class="askForm noteForm">
                  <textarea id="noteText" rows="4" maxlength="10000" aria-label="Nova nota" placeholder="Registre uma observação, hipótese ou conclusão parcial..."></textarea>
                  <div class="askActions"><span class="askHint">⌘/Ctrl + Enter para salvar</span><button id="noteSubmit">Adicionar nota</button></div>
                </form>
                <div id="noteStatus" class="meta"></div>
                <div id="notesList"></div>
              </div>
            </div>
            <div class="tabPanel hidden" data-tab-panel="claims">
              <div class="panel">
                <h2>Quadro de afirmações</h2>
                <p class="meta">Registre cada conclusão com sua classificação e as evidências a favor e contra. A verificação é estrutural: confirma que os itens existem no caso e detecta conteúdo duplicado, mas não avalia se o conteúdo prova a afirmação.</p>
                <form id="claimForm" class="askForm claimForm">
                  <div class="claimRow">
                    <label>Classificação<select id="claimClassification"><option value="FACT">Fato</option><option value="INFERENCE" selected>Inferência</option><option value="HYPOTHESIS">Hipótese</option></select></label>
                    <label id="factBasisField" class="hidden">Base do fato<select id="claimFactBasis"><option value="DOCUMENT_STATEMENT">Declaração em documento</option><option value="OBSERVED_METADATA">Metadado observado</option></select></label>
                  </div>
                  <label>Afirmação<textarea id="claimStatement" rows="3" maxlength="2000" placeholder="Ex.: O documento registra o pagamento de R$ 18.750,00 ao Projeto Atlas."></textarea></label>
                  <label>Evidências a favor<input id="claimSupporting" autocomplete="off" placeholder="Ex.: resultado:8, resultado:4"></label>
                  <label>Evidências contra<input id="claimContradicting" autocomplete="off" placeholder="Opcional"></label>
                  <label>Limitação<input id="claimLimitation" maxlength="2000" autocomplete="off" placeholder="Opcional: o que esta afirmação não estabelece"></label>
                  <div class="askActions"><button type="button" id="claimCancel" class="linkBtn hidden">Cancelar edição</button><button id="claimSubmit">Registrar afirmação</button></div>
                </form>
                <div id="claimStatus" class="meta"></div>
                <div id="claimsList"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
    <div class="composerDock" id="composerDock">
      <div class="composerInner" id="workspaceSidebar">
        <form id="followUpForm" class="composer">
          <textarea id="followUp" rows="1" aria-label="Pergunta de acompanhamento" placeholder="Pergunte algo sobre esta investigação"></textarea>
          <button class="sendBtn" title="Enviar (⌘/Ctrl + Enter)" aria-label="Enviar pergunta"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>
        </form>
        <div class="dockMeta"><span id="dockStatusSlot"></span><span>⌘/Ctrl + Enter para enviar</span></div>
      </div>
    </div>
  </div>
</div>
<div id="evidencePreview" class="previewCard hidden" role="tooltip"></div>
<aside id="evidenceDrawer" class="drawer hidden">
  <div class="drawerHeader"><div><div class="meta">Evidência IPED</div><h2 id="evidenceTitle"></h2></div><div class="drawerActions"><button type="button" id="citeEvidence" title="Inserir a referência deste item no caderno de análise">Citar no caderno</button><button type="button" id="claimEvidence" title="Usar este item como evidência a favor numa afirmação">Usar em afirmação</button><button type="button" id="eventFromEvidence" title="Registrar na linha do tempo do caso um evento datado a partir deste item">Usar em evento</button><button id="closeEvidence">Fechar</button></div></div>
  <div id="evidenceMeta" class="meta"></div>
  <section class="bookmarkBox" aria-label="Marcadores do IPED">
    <div class="bookmarkHead"><h3>Marcadores do IPED</h3><span class="meta">Gravados no caso processado, nunca na evidência original. Cada alteração fica no log de auditoria.</span><span class="meta bookmarkWarning">Não marque itens com o IPED desktop aberto neste mesmo caso: os dois gravam o mesmo arquivo de marcadores e um pode apagar as marcações do outro.</span></div>
    <div id="bookmarkChips" class="chips"></div>
    <form id="bookmarkForm" class="bookmarkForm"><input id="bookmarkName" list="bookmarkOptions" maxlength="80" value="Relevante" aria-label="Nome do marcador" placeholder="Nome do marcador"><datalist id="bookmarkOptions"></datalist><button>Marcar</button></form>
    <div id="bookmarkStatus" class="meta"></div>
  </section>
  <h3>Texto extraído</h3><div id="evidenceText"></div>
  <h3>Metadados</h3><div id="evidenceProperties"></div>
</aside>
<script>
window.addEventListener("error",event=>{
  const connection=document.getElementById("connection");
  const status=document.getElementById("status");
  if(connection) connection.textContent="Erro na interface";
  if(status) status.textContent="A interface encontrou um erro: "+(event.message||"erro desconhecido");
});
let activeInvestigationId;
const byId=id=>document.getElementById(id);
const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
function items(target,values,render){
  byId(target).innerHTML=values?.length?values.map(render).join(""):'<div class="empty">Nenhum item para exibir.</div>';
}
const statusEl=byId("status"),statusHome=statusEl.parentElement,investigationHistory=new Map();
function leaveLanding(){if(!document.body.classList.contains("landing"))return;document.body.classList.remove("landing");byId("dockStatusSlot").appendChild(statusEl);}
function enterLanding(){
  activeInvestigationId=undefined;document.body.classList.add("landing");
  statusHome.insertBefore(statusEl,statusHome.querySelector(".landingNote"));statusEl.textContent="";
  byId("question").value="";byId("question").style.height="";byId("topTitle").textContent="Nova investigação";
  renderHistory();setTimeout(()=>byId("question").focus(),0);
}
function renderHistory(){
  const target=byId("history");
  if(!investigationHistory.size){target.innerHTML='<div class="historyEmpty">Nenhuma investigação ainda.</div>';return;}
  target.innerHTML=[...investigationHistory.entries()].reverse().map(([id,entry])=>'<button type="button" class="historyItem'+(id===activeInvestigationId?' active':'')+'" data-id="'+escapeHtml(id)+'" title="'+escapeHtml(entry.questions[0])+'">'+escapeHtml(entry.questions[0])+'</button>').join("");
  target.querySelectorAll(".historyItem").forEach(button=>button.addEventListener("click",()=>openSavedInvestigation(button.dataset.id)));
}
async function openSavedInvestigation(id){
  const entry=investigationHistory.get(id);if(!entry)return;
  if(!entry.workspace){
    try{
      const response=await fetch("/api/investigations/"+encodeURIComponent(id));
      const result=await response.json();
      if(!response.ok||!result.workspace){statusEl.textContent=result.error||"Não foi possível abrir a investigação.";return;}
      entry.workspace=result.workspace;entry.questions=result.questions||entry.questions;
    }catch{statusEl.textContent="Não foi possível abrir a investigação.";return;}
  }
  renderWorkspace(entry.workspace);selectTab("resumo");byId("mainArea").scrollTop=0;
  if(window.innerWidth<800)setNavCollapsed(true);
}
async function loadSavedInvestigations(){
  try{
    const response=await fetch("/api/investigations"+(selectedSourceId?"?sourceId="+encodeURIComponent(selectedSourceId):""));
    const result=await response.json();
    (result.investigations||[]).slice().reverse().forEach(item=>{if(!investigationHistory.has(item.id))investigationHistory.set(item.id,{questions:[item.title],updatedAt:item.updatedAt});});
    renderHistory();
  }catch{}
}
let notes=[],editingNoteId=null,notesInvestigationId=null;
function referenceSources(){
  const set=new Set(),workspace=investigationHistory.get(activeInvestigationId)?.workspace;
  if(workspace?.case?.sourceId)set.add(String(workspace.case.sourceId));
  (workspace?.panels?.evidence||[]).forEach(item=>{if(item.sourceId)set.add(String(item.sourceId));});
  if(selectedSourceId)set.add(String(selectedSourceId));
  return [...set];
}
function isWordChar(ch){return !!ch&&/[A-Za-z0-9_]/.test(ch);}
function linkReferences(text){
  const sources=referenceSources();let html="",i=0;
  while(i<text.length){
    let best=-1,src="";
    for(const s of sources){const k=text.indexOf(s+":",i);if(k>=0&&(best<0||k<best||(k===best&&s.length>src.length))){best=k;src=s;}}
    if(best<0){html+=escapeHtml(text.slice(i));break;}
    let j=best+src.length+1;while(j<text.length&&text[j]>="0"&&text[j]<="9")j++;
    const digits=text.slice(best+src.length+1,j);
    if(digits&&!isWordChar(text[best-1])&&!isWordChar(text[j])){
      html+=escapeHtml(text.slice(i,best))+'<button type="button" class="evidenceButton noteRef" data-source="'+escapeHtml(src)+'" data-item="'+digits+'">'+escapeHtml(src+":"+digits)+'</button>';i=j;
    }else{html+=escapeHtml(text.slice(i,best+src.length+1));i=best+src.length+1;}
  }
  return html;
}
function formatNoteDate(iso){try{return new Date(iso).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"});}catch{return iso;}}
function resetNoteEditor(){editingNoteId=null;byId("noteSubmit").textContent="Adicionar nota";}
function renderNotes(){
  const list=byId("notesList");
  byId("notebookTab").innerHTML="Caderno"+(notes.length?'<span class="tabCount">'+notes.length+'</span>':"");
  if(!notes.length){list.innerHTML='<div class="empty">Nenhuma nota ainda. Use o caderno para registrar o raciocínio da análise.</div>';return;}
  list.innerHTML=notes.map(note=>'<article class="note" data-id="'+escapeHtml(note.id)+'"><div class="noteMeta"><span>'+escapeHtml(formatNoteDate(note.createdAt))+(note.updatedAt!==note.createdAt?" · editada em "+escapeHtml(formatNoteDate(note.updatedAt)):"")+'</span><span class="noteActions"><button type="button" class="linkBtn noteEdit">Editar</button><button type="button" class="linkBtn noteDelete">Excluir</button></span></div><div class="noteBody">'+linkReferences(note.text)+'</div></article>').join("");
  list.querySelectorAll(".noteRef").forEach(button=>button.addEventListener("click",()=>openEvidence(button.dataset.source,button.dataset.item)));
  list.querySelectorAll(".note").forEach(article=>{
    const note=notes.find(item=>item.id===article.dataset.id);
    article.querySelector(".noteEdit").addEventListener("click",()=>{editingNoteId=note.id;const field=byId("noteText");field.value=note.text;field.dispatchEvent(new Event("input"));byId("noteSubmit").textContent="Salvar alteração";byId("noteStatus").textContent="Editando nota.";field.focus();});
    const remove=article.querySelector(".noteDelete");
    remove.addEventListener("click",async()=>{
      if(remove.dataset.confirm!=="1"){remove.dataset.confirm="1";remove.textContent="Confirmar exclusão";setTimeout(()=>{remove.dataset.confirm="";remove.textContent="Excluir";},4000);return;}
      const id=activeInvestigationId;
      try{
        const response=await fetch("/api/investigations/"+encodeURIComponent(id)+"/notes/"+encodeURIComponent(note.id)+"/delete",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
        const result=await response.json();
        if(!response.ok){byId("noteStatus").textContent=result.error||"Não foi possível excluir a nota.";return;}
        notes=notes.filter(item=>item.id!==note.id);if(editingNoteId===note.id){resetNoteEditor();byId("noteText").value="";}
        byId("noteStatus").textContent="Nota excluída.";renderNotes();
      }catch{byId("noteStatus").textContent="Não foi possível excluir a nota.";}
    });
  });
}
async function loadNotes(id){
  notesInvestigationId=id;notes=[];resetNoteEditor();byId("noteText").value="";byId("noteStatus").textContent="";renderNotes();
  if(!id)return;
  try{const response=await fetch("/api/investigations/"+encodeURIComponent(id)+"/notes");if(response.ok&&notesInvestigationId===id){notes=(await response.json()).notes||[];renderNotes();}}catch{}
}
byId("noteForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const text=byId("noteText").value.trim(),id=activeInvestigationId;if(!text||!id)return;
  const path="/api/investigations/"+encodeURIComponent(id)+"/notes"+(editingNoteId?"/"+encodeURIComponent(editingNoteId):"");
  byId("noteSubmit").disabled=true;
  try{
    const response=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text})});
    const result=await response.json();
    if(!response.ok){byId("noteStatus").textContent=result.error||"Não foi possível salvar a nota.";return;}
    if(editingNoteId)notes=notes.map(item=>item.id===result.note.id?result.note:item);else notes.push(result.note);
    resetNoteEditor();byId("noteText").value="";byId("noteText").style.height="";byId("noteStatus").textContent="Nota salva.";renderNotes();
  }catch{byId("noteStatus").textContent="Não foi possível salvar a nota.";}
  finally{byId("noteSubmit").disabled=false;}
});
let claims=[],editingClaimId=null,claimsInvestigationId=null;
const CLAIM_LABEL={FACT:"Fato",INFERENCE:"Inferência",HYPOTHESIS:"Hipótese"};
const BASIS_LABEL={DOCUMENT_STATEMENT:"declaração em documento",OBSERVED_METADATA:"metadado observado"};
function parseReferences(value){
  const sources=referenceSources(),refs=[],unknown=[];
  value.split(/[ ,;]+/).map(token=>token.split("[").join("").split("]").join("").trim()).filter(Boolean).forEach(token=>{
    const at=token.lastIndexOf(":"),src=token.slice(0,at),item=token.slice(at+1);
    if(at>0&&sources.includes(src)&&/^[0-9]+$/.test(item))refs.push({sourceId:src,itemId:Number(item)});else unknown.push(token);
  });
  return {refs,unknown};
}
function refsText(refs){return (refs||[]).map(ref=>ref.sourceId+":"+ref.itemId).join(", ");}
function refButtons(refs,missing){
  const absent=new Set((missing||[]).map(ref=>ref.sourceId+":"+ref.itemId));
  return (refs||[]).map(ref=>{const key=ref.sourceId+":"+ref.itemId;return absent.has(key)?'<span class="missingRef" title="Não encontrada no caso">'+escapeHtml(key)+'</span>':'<button type="button" class="evidenceButton claimRef" data-source="'+escapeHtml(ref.sourceId)+'" data-item="'+escapeHtml(ref.itemId)+'">'+escapeHtml(key)+'</button>';}).join("");
}
function syncFactBasis(){byId("factBasisField").classList.toggle("hidden",byId("claimClassification").value!=="FACT");}
function resetClaimForm(){
  editingClaimId=null;byId("claimSubmit").textContent="Registrar afirmação";byId("claimCancel").classList.add("hidden");
  ["claimStatement","claimSupporting","claimContradicting","claimLimitation"].forEach(id=>{byId(id).value="";});
  byId("claimClassification").value="INFERENCE";byId("claimStatement").style.height="";syncFactBasis();
}
function verificationHtml(v){
  if(!v)return "";
  const warn=(v.warnings||[]).length>0;
  return '<div class="claimCheck'+(warn?" warn":"")+'">'+(v.referencesVerified?"✓ Referências encontradas no caso":"Há referências não encontradas no caso")+" · "+escapeHtml(v.independentSupportingCount)+" evidência(s) independente(s) a favor de "+escapeHtml(v.supportingCount)+" confirmada(s)"+(warn?'<ul>'+v.warnings.map(w=>'<li>'+escapeHtml(w)+'</li>').join("")+'</ul>':"")+'</div>';
}
function renderClaims(){
  byId("claimsTab").innerHTML="Afirmações"+(claims.length?'<span class="tabCount">'+claims.length+'</span>':"");
  const list=byId("claimsList");
  if(!claims.length){list.innerHTML='<div class="empty">Nenhuma afirmação registrada. Registre aqui as conclusões que pretende sustentar.</div>';return;}
  list.innerHTML=["FACT","INFERENCE","HYPOTHESIS"].map(kind=>{
    const group=claims.filter(c=>c.classification===kind);if(!group.length)return "";
    return '<section class="claimGroup"><h3>'+CLAIM_LABEL[kind]+'s ('+group.length+')</h3>'+group.map(c=>'<article class="claim" data-id="'+escapeHtml(c.id)+'"><div class="claimHead"><span class="claimBadge '+c.classification+'">'+CLAIM_LABEL[c.classification]+'</span>'+(c.factBasis?'<span class="meta">base: '+BASIS_LABEL[c.factBasis]+'</span>':"")+'<span class="noteActions"><button type="button" class="linkBtn claimVerify">Reverificar</button><button type="button" class="linkBtn claimEdit">Editar</button><button type="button" class="linkBtn claimDelete">Excluir</button></span></div><div class="claimStatement">'+escapeHtml(c.statement)+'</div><div class="claimRefs"><span class="meta">A favor: </span>'+(c.supporting.length?refButtons(c.supporting,c.verification?.missing):'<span class="meta">nenhuma</span>')+(c.contradicting.length?'<br><span class="meta">Contra: </span>'+refButtons(c.contradicting,c.verification?.missing):"")+'</div>'+(c.limitation?'<div class="meta">Limitação: '+escapeHtml(c.limitation)+'</div>':"")+verificationHtml(c.verification)+'</article>').join("")+'</section>';
  }).join("");
  list.querySelectorAll(".claimRef").forEach(button=>button.addEventListener("click",()=>openEvidence(button.dataset.source,button.dataset.item)));
  list.querySelectorAll(".claim").forEach(article=>{
    const claim=claims.find(c=>c.id===article.dataset.id);
    article.querySelector(".claimEdit").addEventListener("click",()=>{
      editingClaimId=claim.id;byId("claimClassification").value=claim.classification;syncFactBasis();
      if(claim.factBasis)byId("claimFactBasis").value=claim.factBasis;
      byId("claimStatement").value=claim.statement;byId("claimSupporting").value=refsText(claim.supporting);
      byId("claimContradicting").value=refsText(claim.contradicting);byId("claimLimitation").value=claim.limitation||"";
      byId("claimSubmit").textContent="Salvar alteração";byId("claimCancel").classList.remove("hidden");
      byId("claimStatus").textContent="Editando afirmação.";byId("claimStatement").focus();
    });
    article.querySelector(".claimVerify").addEventListener("click",()=>claimRequest("/"+encodeURIComponent(claim.id)+"/verify",{},"Verificação atualizada."));
    const remove=article.querySelector(".claimDelete");
    remove.addEventListener("click",()=>{
      if(remove.dataset.confirm!=="1"){remove.dataset.confirm="1";remove.textContent="Confirmar exclusão";setTimeout(()=>{remove.dataset.confirm="";remove.textContent="Excluir";},4000);return;}
      claimRequest("/"+encodeURIComponent(claim.id)+"/delete",{},"Afirmação excluída.",claim.id);
    });
  });
}
async function claimRequest(suffix,payload,message,deletedId){
  const id=activeInvestigationId;if(!id)return false;
  try{
    const response=await fetch("/api/investigations/"+encodeURIComponent(id)+"/claims"+suffix,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
    const result=await response.json();
    if(!response.ok){byId("claimStatus").textContent=result.error||"Não foi possível salvar a afirmação.";return false;}
    if(deletedId){claims=claims.filter(c=>c.id!==deletedId);if(editingClaimId===deletedId)resetClaimForm();}
    else if(claims.some(c=>c.id===result.claim.id))claims=claims.map(c=>c.id===result.claim.id?result.claim:c);
    else claims.push(result.claim);
    byId("claimStatus").textContent=message;renderClaims();return true;
  }catch{byId("claimStatus").textContent="Não foi possível salvar a afirmação.";return false;}
}
async function loadClaims(id){
  claimsInvestigationId=id;claims=[];resetClaimForm();byId("claimStatus").textContent="";renderClaims();
  if(!id)return;
  try{const response=await fetch("/api/investigations/"+encodeURIComponent(id)+"/claims");if(response.ok&&claimsInvestigationId===id){claims=(await response.json()).claims||[];renderClaims();}}catch{}
}
byId("claimClassification").addEventListener("change",syncFactBasis);
byId("claimCancel").addEventListener("click",()=>{resetClaimForm();byId("claimStatus").textContent="";});
byId("claimForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const supporting=parseReferences(byId("claimSupporting").value),contradicting=parseReferences(byId("claimContradicting").value);
  const unknown=[...supporting.unknown,...contradicting.unknown];
  if(unknown.length){byId("claimStatus").textContent="Referência não reconhecida: "+unknown.join(", ")+". Use o formato fonte:item, como "+(referenceSources()[0]||"fonte")+":8.";return;}
  const classification=byId("claimClassification").value;
  const payload={classification,statement:byId("claimStatement").value,supporting:supporting.refs,contradicting:contradicting.refs,limitation:byId("claimLimitation").value,factBasis:classification==="FACT"?byId("claimFactBasis").value:undefined};
  byId("claimSubmit").disabled=true;byId("claimStatus").textContent="Verificando evidências no IPED...";
  const ok=await claimRequest(editingClaimId?"/"+encodeURIComponent(editingClaimId):"",payload,editingClaimId?"Afirmação atualizada e verificada.":"Afirmação registrada e verificada.");
  byId("claimSubmit").disabled=false;
  if(ok)resetClaimForm();
});
function renderThread(entry){
  byId("questionCard").innerHTML=entry.questions.map((q,i)=>'<div class="bubble">'+(i?'<span class="kicker">Pergunta de acompanhamento</span>':'')+escapeHtml(q)+'</div>').join("");
  byId("topTitle").textContent=entry.questions[0];
}
function setNavCollapsed(collapsed){document.body.classList.toggle("navCollapsed",collapsed);try{localStorage.setItem("ipedMcpNavCollapsed",collapsed?"1":"0")}catch{}}
try{if(localStorage.getItem("ipedMcpNavCollapsed")==="1"||window.innerWidth<800)document.body.classList.add("navCollapsed")}catch{if(window.innerWidth<800)document.body.classList.add("navCollapsed")}
byId("navToggle").addEventListener("click",()=>setNavCollapsed(true));
byId("navOpen").addEventListener("click",()=>setNavCollapsed(false));
byId("newInvestigation").addEventListener("click",()=>{enterLanding();if(window.innerWidth<800)setNavCollapsed(true);});
function renderWorkspace(workspace){
  leaveLanding();
  activeInvestigationId=workspace.investigationId;
  byId("workspaceSidebar").classList.remove("hidden");
  byId("workspaceMain").classList.remove("hidden");
  byId("mainEmptyState").classList.add("hidden");
  const entry=investigationHistory.get(workspace.investigationId)||{questions:[workspace.title||"Investigação"]};
  entry.workspace=workspace;investigationHistory.set(workspace.investigationId,entry);
  renderThread(entry);renderHistory();
  if(notesInvestigationId!==workspace.investigationId)loadNotes(workspace.investigationId);
  if(claimsInvestigationId!==workspace.investigationId)loadClaims(workspace.investigationId);
  if(eventsInvestigationId!==workspace.investigationId)loadEvents(workspace.investigationId);
  byId("exportReport").href="/api/investigations/"+encodeURIComponent(workspace.investigationId)+"/report";
  const directTarget=byId("directAnswer"),direct=workspace.directAnswer;
  if(direct?.kind==="EVIDENCE_LIST"){
    directTarget.classList.remove("hidden");
    directTarget.innerHTML='<h2>Resposta à pergunta</h2><p>'+escapeHtml(direct.headline)+'</p><div style="overflow:auto"><table style="width:100%;border-collapse:collapse"><thead><tr>'+direct.columns.map(c=>'<th style="text-align:left;padding:9px;border-bottom:1px solid #dfe4ea">'+escapeHtml(c)+'</th>').join("")+'<th style="text-align:left;padding:9px;border-bottom:1px solid #dfe4ea">Ação</th></tr></thead><tbody>'+direct.rows.map(r=>'<tr><td style="padding:9px;border-bottom:1px solid #edf0f3">'+escapeHtml(r.item)+'</td><td style="padding:9px;border-bottom:1px solid #edf0f3">'+escapeHtml(r.type)+'</td><td style="padding:9px;border-bottom:1px solid #edf0f3">'+escapeHtml(r.path)+'</td><td style="padding:9px;border-bottom:1px solid #edf0f3">'+escapeHtml(r.reference)+'</td><td style="padding:9px;border-bottom:1px solid #edf0f3"><button type="button" class="evidenceButton directEvidenceButton" data-source="'+escapeHtml(r.sourceId)+'" data-item="'+escapeHtml(r.itemId)+'">Abrir evidência</button></td></tr>').join("")+'</tbody></table></div>';
    directTarget.querySelectorAll(".directEvidenceButton").forEach(button=>button.addEventListener("click",()=>openEvidence(button.dataset.source,button.dataset.item)));
  }else{directTarget.classList.add("hidden");directTarget.innerHTML="";}
  const ambiguityTarget=byId("retrievalAmbiguities");
  const ambiguities=workspace.panels?.retrievalAmbiguities||[];
  if(ambiguities.length){
    ambiguityTarget.classList.remove("hidden");
    ambiguityTarget.innerHTML='<h2>Ambiguidade nos resultados da busca</h2>'
      +ambiguities.map(group=>'<p>'+escapeHtml(group.description)+'</p>'
        +group.candidates.map(candidate=>'<div class="observation"><strong>'+escapeHtml(candidate.value)+'</strong> · '
          +candidate.evidence.map(ref=>'<button type="button" class="evidenceButton ambiguityEvidenceButton" data-source="'+escapeHtml(ref.sourceId)+'" data-item="'+escapeHtml(ref.itemId)+'">['+escapeHtml(ref.sourceId)+':'+escapeHtml(ref.itemId)+']</button>').join(' ')+'</div>').join('')).join('');
    ambiguityTarget.querySelectorAll(".ambiguityEvidenceButton").forEach(button=>button.addEventListener("click",()=>openEvidence(button.dataset.source,button.dataset.item)));
  }else{
    ambiguityTarget.classList.add("hidden");
    ambiguityTarget.innerHTML="";
  }
  const aiAnalysis=workspace.aiAnalysis;
  const aiTarget=byId("aiAnalysis");
  if(aiAnalysis?.enabled){
    aiTarget.classList.remove("hidden");
    const findings=(aiAnalysis.findings||[]).map(finding=>{
      const refs=(finding.evidence||[]).map(reference=>{const parts=String(reference).split(":");const itemId=parts.pop(),sourceId=parts.join(":");return '<button type="button" class="evidenceButton aiEvidenceButton" data-source="'+escapeHtml(sourceId)+'" data-item="'+escapeHtml(itemId)+'">['+escapeHtml(reference)+']</button>';}).join(" ");
      return '<div class="observation"><strong>'+escapeHtml(finding.kind)+'</strong> · '+escapeHtml(finding.statement)+'<div>'+refs+'</div></div>';
    }).join("");
    const limitations=(aiAnalysis.limitations||[]).map(item=>'<li>'+escapeHtml(item)+'</li>').join("");
    const nextSteps=(aiAnalysis.nextSteps||[]).map(item=>'<li>'+escapeHtml(item)+'</li>').join("");
    aiTarget.innerHTML='<h2>Análise assistida por IA</h2>'
      +(findings?'<h3>Achados</h3>'+findings:(aiAnalysis.text?'<div class="evidenceText">'+escapeHtml(aiAnalysis.text)+'</div>':'<p class="meta">Nenhum achado adicional sustentado pelas evidências foi produzido pela IA.</p>'))
      +(limitations?'<h3>Limitações</h3><ul>'+limitations+'</ul>':'')
      +(nextSteps?'<h3>Próximos passos</h3><ul>'+nextSteps+'</ul>':'')
      +'<p class="meta">Análise derivada · modelo '+escapeHtml(aiAnalysis.model||"configurado")+' · cada achado deve ser validado nas evidências citadas.</p>';
    aiTarget.querySelectorAll(".aiEvidenceButton").forEach(button=>button.addEventListener("click",()=>openEvidence(button.dataset.source,button.dataset.item)));
  }else if(aiAnalysis?.reason&&aiAnalysis.reason!=="AI analysis is not configured."){
    aiTarget.classList.remove("hidden");
    aiTarget.innerHTML='<h2>Análise assistida por IA não apresentada</h2><p>A resposta produzida pelo modelo não atingiu os critérios de rastreabilidade e sustentação nas evidências.</p><p class="meta">Os achados objetivos do IPED permanecem disponíveis abaixo. A resposta rejeitada não é exibida.</p>';
  }else{
    aiTarget.classList.add("hidden");
    aiTarget.innerHTML="";
  }
  const valueVariations=workspace.panels?.valueVariations||[];
  const inconsistencyTarget=byId("valueVariations");
  if(inconsistencyTarget){
    if(valueVariations.length){
      inconsistencyTarget.classList.remove("hidden");
      inconsistencyTarget.innerHTML='<h2>Variações monetárias observadas</h2>'+valueVariations.map(item=>'<div class="observation"><strong>'+escapeHtml(item.type)+'</strong> · '+escapeHtml(item.description)+'</div>').join("");
    }else{
      inconsistencyTarget.classList.add("hidden");
      inconsistencyTarget.innerHTML="";
    }
  }
  const analysis=workspace.analysis||{};
  const observations=(analysis.observations||[]).map(item=>'<div class="observation">'+escapeHtml(item.text)+'<div>'+(item.evidence||[]).map(e=>'<button type="button" class="evidenceButton analysisEvidenceButton" data-source="'+escapeHtml(e.sourceId)+'" data-item="'+escapeHtml(e.itemId)+'">'+escapeHtml(e.sourceId)+':'+escapeHtml(e.itemId)+'</button>').join(" · ")+'</div></div>').join("");
  byId("analysis").innerHTML='<h2>Síntese da investigação</h2><p>'+escapeHtml(analysis.headline||"")+'</p>'+observations+(analysis.communication?'<p>'+escapeHtml(analysis.communication)+'</p>':"")+(analysis.limitation?'<p class="meta">'+escapeHtml(analysis.limitation)+'</p>':"");
  byId("analysis").querySelectorAll(".analysisEvidenceButton").forEach(button=>button.addEventListener("click",()=>openEvidence(button.dataset.source,button.dataset.item)));
  const s=workspace.summary||{};
  if(workspace.resultState?.evidenceSearchTruncated){
    const available=workspace.resultState.evidenceSearchAvailable;
    const detail=Number.isFinite(available)
      ? ' O IPED retornou '+escapeHtml(available)+' referência(s) para esta busca; apenas o subconjunto limitado foi analisado nesta etapa.'
      : '';
    byId("analysis").innerHTML+='<p class="meta"><b>Limite da busca atingido.</b>'+detail+' O conjunto exibido não deve ser interpretado como exaustivo.</p>';
  }
  const metrics=[["Evidências",s.evidenceCount],["Entidades",s.entityCount],["Relações",s.relationshipCount],["Comunicações",s.communicationParticipantCount],["Correlações pendentes",s.openLeadCount]];
  byId("summary").innerHTML=metrics.map(([label,value])=>'<div class="metric"><b>'+escapeHtml(value??0)+'</b><span>'+label+'</span></div>').join("");
  items("findings",workspace.panels?.findings,f=>'<div class="item"><b>'+escapeHtml(f.value)+'</b><div class="meta">'+escapeHtml(f.type)+' · observado em '+escapeHtml(f.evidenceCount)+' evidência(s)</div><div>'+(f.evidence||[]).map(e=>'<button type="button" class="evidenceButton findingEvidenceButton" data-source="'+escapeHtml(e.sourceId)+'" data-item="'+escapeHtml(e.itemId)+'">'+escapeHtml(e.sourceId)+':'+escapeHtml(e.itemId)+'</button>').join(" · ")+'</div></div>');
    items("evidence",workspace.panels?.evidence,e=>'<div class="item"><button type="button" class="evidenceButton" data-source="'+escapeHtml(e.sourceId)+'" data-item="'+escapeHtml(e.itemId)+'">'+escapeHtml(e.name||"Evidência")+'</button><div class="meta">'+escapeHtml(e.path||"")+' · item '+escapeHtml(e.itemId)+'</div></div>');
  document.querySelectorAll(".evidenceButton").forEach(button=>button.addEventListener("click",()=>openEvidence(button.dataset.source,button.dataset.item)));
  items("leads",workspace.panels?.leads,l=>'<div class="item" data-lead-type="'+escapeHtml(l.type)+'" data-lead-value="'+escapeHtml(l.value)+'"><div class="lead"><div><b>'+escapeHtml(l.value)+'</b><div class="meta">'+escapeHtml(l.type)+'</div></div>'+(l.status==="OPEN"?'<button type="button" class="leadButton" data-type="'+escapeHtml(l.type)+'" data-value="'+escapeHtml(l.value)+'">Explorar</button>':'<span class="badge leadStatusBadge">'+escapeHtml(l.status)+'</span>')+'</div><div>'+(l.evidence||[]).map(e=>'<button type="button" class="evidenceButton leadEvidenceButton" data-source="'+escapeHtml(e.sourceId)+'" data-item="'+escapeHtml(e.itemId)+'">'+escapeHtml(e.sourceId)+':'+escapeHtml(e.itemId)+'</button>').join(" · ")+'</div></div>');
  document.querySelectorAll(".leadButton").forEach(button=>button.addEventListener("click",()=>exploreLead(button.dataset.type,button.dataset.value)));
  renderGraph(workspace.panels?.relationships);
  items("timeline",workspace.panels?.timeline,t=>'<div class="item"><div class="lead"><div><b>'+escapeHtml(t.label||t.name||"Evento")+'</b><div class="meta">'+escapeHtml(t.event||"data")+' · '+escapeHtml(t.timestamp||t.date||"")+'</div>'+(t.path?'<div class="meta">'+escapeHtml(t.path)+'</div>':'')+'</div>'+(t.sourceId!=null&&t.itemId!=null?'<button type="button" class="timelineEvidenceButton" data-source="'+escapeHtml(t.sourceId)+'" data-item="'+escapeHtml(t.itemId)+'">Abrir evidência</button>':'')+'</div></div>');
  document.querySelectorAll(".timelineEvidenceButton").forEach(button=>button.addEventListener("click",()=>openEvidence(button.dataset.source,button.dataset.item)));
  byId("status").textContent=workspace.status?.message||"Investigação atualizada.";
}
function renderGraph(graph){
  const target=byId("relationships"),detail=byId("relationshipDetail");
  detail.innerHTML="";
  if(!graph?.nodes?.length){target.innerHTML='<div class="empty">Nenhuma relação para exibir.</div>';return}
  const nodeCount=graph.summary?.nodeCount??graph.nodes.length,edgeCount=graph.summary?.edgeCount??(graph.edges?.length||0);
  const relationshipDensity=nodeCount?edgeCount/nodeCount:0;
  const automatic=edgeCount>=8&&relationshipDensity>=2.5?"hierarchical":nodeCount<=18?"radial":nodeCount<=60?"grid":"wide";
  let layout=automatic;
  const draw=()=>{
    const cols=layout==="radial"?0:layout==="hierarchical"?Math.max(1,graph.nodes.filter(n=>n.kind==="EVIDENCE").length):Math.max(4,Math.ceil(Math.sqrt(nodeCount*1.5)));
    const cellW=190,cellH=110;
    let width,height; const positions=new Map();
    if(layout==="radial"){
      width=Math.max(900,nodeCount*58);height=Math.max(680,Math.ceil(nodeCount/12)*180+500);
      const cx=width/2,cy=height/2,r=Math.max(230,Math.min(width,height)*.36);
      graph.nodes.forEach((node,index)=>{const a=Math.PI*2*index/nodeCount-Math.PI/2;positions.set(node.id,{x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r});});
    }else if(layout==="hierarchical"){
      const lanes=new Map();
      graph.nodes.forEach(node=>{const lane=node.kind==="EVIDENCE"?"EVIDENCE":(node.entityType||node.kind);const list=lanes.get(lane)||[];list.push(node);lanes.set(lane,list);});
      const laneEntries=[...lanes.entries()],maxRow=Math.max(1,...laneEntries.map(([,nodes])=>nodes.length));
      width=Math.max(1000,maxRow*180);height=Math.max(620,laneEntries.length*190+100);
      laneEntries.forEach(([,nodes],laneIndex)=>nodes.forEach((n,i)=>positions.set(n.id,{x:(i+1)*width/(nodes.length+1),y:100+laneIndex*190})));
    }else{
      const useCols=Math.max(4,Math.ceil(Math.sqrt(nodeCount*(layout==="wide"?2.2:1.5))));
      const rows=Math.ceil(nodeCount/useCols);width=Math.max(1000,useCols*cellW);height=Math.max(680,rows*cellH+140);
      graph.nodes.forEach((node,index)=>{const row=Math.floor(index/useCols),col=index%useCols;positions.set(node.id,{x:95+col*cellW,y:75+row*cellH});});
    }
    const laneLabels=layout==="hierarchical"?[...new Set(graph.nodes.map(node=>node.kind==="EVIDENCE"?"EVIDENCE":(node.entityType||node.kind)))].map((lane,index)=>'<text class="laneLabel" x="20" y="'+(78+index*190)+'">'+escapeHtml(lane)+'</text>').join(""):"";
    const edges=(graph.edges||[]).map(edge=>{const a=positions.get(edge.from),b=positions.get(edge.to);if(!a||!b)return"";return '<line class="edge" data-edge="'+escapeHtml(edge.id)+'" x1="'+a.x+'" y1="'+a.y+'" x2="'+b.x+'" y2="'+b.y+'"></line>';}).join("");
    const nodes=graph.nodes.map(node=>{const p=positions.get(node.id),kind=node.kind==="EVIDENCE"?"evidence":node.kind==="COMMUNICATION_PARTICIPANT"?"communication":"entity";const label=String(node.label||"");return '<g class="node '+kind+'" data-node="'+escapeHtml(node.id)+'" transform="translate('+p.x+' '+p.y+')"><circle r="14"></circle><title>'+escapeHtml(label)+'</title><text x="20" y="4">'+escapeHtml(label.length>30?label.slice(0,29)+"…":label)+'</text></g>';}).join("");
    target.innerHTML='<div class="graphToolbar"><span class="meta">'+escapeHtml(nodeCount)+' nós · '+escapeHtml(edgeCount)+' relações</span><label class="meta">Visualização <select data-graph-layout><option value="radial">Radial</option><option value="grid">Grade</option><option value="wide">Ampla</option><option value="hierarchical">Evidências × entidades</option></select></label><label class="meta">Localizar <input type="search" data-graph-search placeholder="Nome, valor ou tipo" aria-label="Localizar nó no grafo"></label><span class="meta" data-graph-search-status></span><span class="meta" data-graph-search-hint>Enter: próximo · Esc: limpar · Ctrl/Cmd + roda: zoom</span><select data-graph-search-results aria-label="Resultados localizados" class="hidden"><option value="">Escolha um nó...</option></select><button type="button" data-graph-action="minus">−</button><button type="button" data-graph-action="reset">100%</button><button type="button" data-graph-action="fit">Ajustar</button><button type="button" data-graph-action="plus">+</button><button type="button" data-graph-action="full">Tela cheia</button></div><div class="graphShell"><div class="graph"><svg width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'"><g class="viewport">'+laneLabels+edges+nodes+'</g></svg></div><div class="graphMiniMap" title="Visão geral da rede"><svg viewBox="0 0 '+width+' '+height+'" preserveAspectRatio="none">'+graph.nodes.map(node=>{const p=positions.get(node.id);return '<circle cx="'+p.x+'" cy="'+p.y+'" r="'+Math.max(5,Math.min(width,height)/120)+'"></circle>';}).join("")+'<rect class="miniViewport" x="0" y="0" width="1" height="1"></rect></svg></div></div>';
    target.querySelector("[data-graph-layout]").value=layout;
    const graphBox=target.querySelector(".graph"),viewport=target.querySelector(".viewport"),miniMap=target.querySelector(".graphMiniMap");let scale=1;
    miniMap.addEventListener("click",event=>{
      const rect=miniMap.getBoundingClientRect();
      const ratioX=(event.clientX-rect.left)/rect.width,ratioY=(event.clientY-rect.top)/rect.height;
      graphBox.scrollTo({left:Math.max(0,ratioX*graphBox.scrollWidth-graphBox.clientWidth/2),top:Math.max(0,ratioY*graphBox.scrollHeight-graphBox.clientHeight/2),behavior:"smooth"});
    });
    const updateMiniViewport=()=>{
      const rect=miniMap.querySelector(".miniViewport");
      const fullW=Math.max(graphBox.scrollWidth,1),fullH=Math.max(graphBox.scrollHeight,1);
      rect.setAttribute("x",String(graphBox.scrollLeft/fullW*width));
      rect.setAttribute("y",String(graphBox.scrollTop/fullH*height));
      rect.setAttribute("width",String(Math.min(width,graphBox.clientWidth/fullW*width)));
      rect.setAttribute("height",String(Math.min(height,graphBox.clientHeight/fullH*height)));
    };
    graphBox.addEventListener("scroll",updateMiniViewport,{passive:true});
    window.addEventListener("resize",updateMiniViewport,{passive:true});
    const graphResizeObserver=typeof ResizeObserver!=="undefined"?new ResizeObserver(updateMiniViewport):null;
    graphResizeObserver?.observe(graphBox);
    requestAnimationFrame(updateMiniViewport);
    const graphSearch=target.querySelector("[data-graph-search]"),graphSearchStatus=target.querySelector("[data-graph-search-status]"),graphSearchResults=target.querySelector("[data-graph-search-results]");
    const focusGraphNode=nodeId=>{
      const nodeEl=[...target.querySelectorAll(".node")].find(el=>el.dataset.node===nodeId);
      if(!nodeEl)return;
      nodeEl.dispatchEvent(new Event("click"));
      const transform=nodeEl.getAttribute("transform")||"";
      const match=transform.match(/translate\(([-.\d]+) ([-.\d]+)\)/);
      if(match){
        const x=Number(match[1])*scale,y=Number(match[2])*scale;
        graphBox.scrollTo({left:Math.max(0,x-graphBox.clientWidth/2),top:Math.max(0,y-graphBox.clientHeight/2),behavior:"smooth"});
      }
    };
    graphSearch.addEventListener("input",()=>{
      const query=graphSearch.value.trim().toLocaleLowerCase("pt-BR");
      let matches=0;
      target.querySelectorAll(".node").forEach(el=>{
        const node=graph.nodes.find(n=>n.id===el.dataset.node);
        const haystack=[node?.label,node?.kind,node?.entityType].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");
        const matched=!query||haystack.includes(query);
        el.style.opacity=matched?"":".12";
        if(query&&matched) matches+=1;
      });
      target.querySelectorAll(".edge").forEach(el=>el.style.opacity=query?".08":"");
      graphSearchStatus.textContent=query?(matches+" nó(s) localizado(s)"):"";
      const matchingNodes=query?graph.nodes.filter(n=>[n.label,n.kind,n.entityType].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR").includes(query)):[];
      graphSearchResults.innerHTML='<option value="">'+(matches>1?"Escolha um dos "+matches+" nós...":"Escolha um nó...")+'</option>'+matchingNodes.map(node=>'<option value="'+escapeHtml(node.id)+'">'+escapeHtml((node.label||node.id)+" · "+(node.entityType||node.kind))+'</option>').join("");
      graphSearchResults.classList.toggle("hidden",matches<=1);
      if(query&&matches===1){
        const match=[...target.querySelectorAll(".node")].find(el=>el.style.opacity!=="0.12");
        if(match) focusGraphNode(match.dataset.node);
      }
    });
    graphSearchResults.addEventListener("change",()=>{if(graphSearchResults.value)focusGraphNode(graphSearchResults.value);});
    graphSearch.addEventListener("keydown",event=>{
      if(event.key==="Escape"){
        event.preventDefault();graphSearch.value="";graphSearch.dispatchEvent(new Event("input"));
        target.querySelectorAll(".node,.edge").forEach(el=>{el.style.opacity="";el.style.strokeWidth="";});
        detail.innerHTML="";graphSearch.focus();return;
      }
      if(event.key!=="Enter")return;
      const options=[...graphSearchResults.options].filter(option=>option.value);
      if(!options.length)return;
      event.preventDefault();
      const current=options.findIndex(option=>option.value===graphSearchResults.value);
      const next=options[(current+1)%options.length];
      graphSearchResults.value=next.value;focusGraphNode(next.value);
    });
    const graphSvg=viewport.closest("svg");
    const applyZoom=()=>{
      viewport.removeAttribute("transform");
      graphSvg.setAttribute("width",String(Math.max(1,width*scale)));
      graphSvg.setAttribute("height",String(Math.max(1,height*scale)));
      graphSvg.setAttribute("viewBox","0 0 "+width+" "+height);
      updateMiniViewport();
    };
    graphBox.addEventListener("wheel",event=>{
      if(!(event.ctrlKey||event.metaKey)) return;
      event.preventDefault();
      scale=Math.max(.35,Math.min(2.5,scale+(event.deltaY<0?.12:-.12)));
      applyZoom();
    },{passive:false});
    let dragging=false,startX=0,startY=0,startLeft=0,startTop=0;
    graphBox.addEventListener("pointerdown",event=>{
      if(event.target.closest("button,input,select,.node,.edge")) return;
      dragging=true;startX=event.clientX;startY=event.clientY;startLeft=graphBox.scrollLeft;startTop=graphBox.scrollTop;
      graphBox.setPointerCapture(event.pointerId);graphBox.style.cursor="grabbing";
    });
    graphBox.addEventListener("pointermove",event=>{
      if(!dragging)return;
      graphBox.scrollLeft=startLeft-(event.clientX-startX);graphBox.scrollTop=startTop-(event.clientY-startY);
    });
    const stopDrag=event=>{if(!dragging)return;dragging=false;graphBox.style.cursor="";if(graphBox.hasPointerCapture(event.pointerId))graphBox.releasePointerCapture(event.pointerId);};
    graphBox.addEventListener("pointerup",stopDrag);graphBox.addEventListener("pointercancel",stopDrag);
    target.querySelector("[data-graph-layout]").addEventListener("change",event=>{layout=event.currentTarget.value;draw();});
    target.querySelector('[data-graph-action="plus"]').addEventListener("click",()=>{scale=Math.min(2.5,scale+.2);applyZoom();});
    target.querySelector('[data-graph-action="minus"]').addEventListener("click",()=>{scale=Math.max(.35,scale-.2);applyZoom();});
    target.querySelector('[data-graph-action="reset"]').addEventListener("click",()=>{scale=1;applyZoom();graphBox.scrollTo({left:0,top:0});});
    target.querySelector('[data-graph-action="fit"]').addEventListener("click",()=>{
      const availableW=Math.max(1,graphBox.clientWidth-24),availableH=Math.max(1,graphBox.clientHeight-24);
      scale=Math.max(.05,Math.min(1,availableW/width,availableH/height));
      applyZoom();graphBox.scrollTo({left:0,top:0,behavior:"smooth"});
    });
    target.querySelector('[data-graph-action="full"]').addEventListener("click",event=>{const graphShell=graphBox.closest(".graphShell");graphShell.classList.toggle("fullscreen");event.currentTarget.textContent=graphShell.classList.contains("fullscreen")?"Sair da tela cheia":"Tela cheia";requestAnimationFrame(updateMiniViewport);});
    target.querySelectorAll(".node").forEach(el=>el.addEventListener("click",()=>{const node=graph.nodes.find(n=>n.id===el.dataset.node);if(!node)return;target.querySelectorAll(".node").forEach(n=>n.style.opacity="0.2");target.querySelectorAll(".edge").forEach(e=>e.style.opacity="0.12");el.style.opacity="1";const connected=new Set([node.id]);(graph.edges||[]).forEach(edge=>{if(edge.from===node.id||edge.to===node.id){connected.add(edge.from);connected.add(edge.to);const edgeEl=target.querySelector('[data-edge="'+CSS.escape(edge.id)+'"]');if(edgeEl){edgeEl.style.opacity="1";edgeEl.style.strokeWidth="3";}}});target.querySelectorAll(".node").forEach(n=>{if(connected.has(n.dataset.node))n.style.opacity="1";});const supporting=(graph.edges||[]).filter(e=>e.from===node.id||e.to===node.id).flatMap(e=>e.evidence||[]);const unique=[...new Map(supporting.map(e=>[e.sourceId+":"+e.itemId,e])).values()];detail.innerHTML='<div class="graphDetail"><b>'+escapeHtml(node.label)+'</b><div class="meta">'+escapeHtml(node.kind)+(node.entityType?" · "+escapeHtml(node.entityType):"")+'</div><div>'+unique.length+' evidência(s) de suporte</div>'+unique.map(e=>'<button type="button" class="graphEvidenceButton" data-source="'+escapeHtml(e.sourceId)+'" data-item="'+escapeHtml(e.itemId)+'">Abrir '+escapeHtml(e.sourceId)+':'+escapeHtml(e.itemId)+'</button>').join(" ")+' <button type="button" id="clearGraphFocus">Mostrar toda a rede</button></div>';detail.querySelectorAll(".graphEvidenceButton").forEach(button=>button.addEventListener("click",()=>openEvidence(button.dataset.source,button.dataset.item)));byId("clearGraphFocus").addEventListener("click",()=>{target.querySelectorAll(".node,.edge").forEach(n=>{n.style.opacity="";n.style.strokeWidth="";});detail.innerHTML="";});}));
    target.querySelectorAll(".edge").forEach(el=>el.addEventListener("click",()=>{const edge=(graph.edges||[]).find(e=>e.id===el.dataset.edge);if(!edge)return;const supporting=edge.evidence||[];detail.innerHTML='<div class="graphDetail"><b>'+escapeHtml(edge.relationship)+'</b><div>'+escapeHtml(edge.interpretation||"Relação observada nas evidências.")+'</div><div class="meta">'+supporting.map(e=>escapeHtml(e.sourceId)+":"+escapeHtml(e.itemId)).join(" · ")+'</div>'+supporting.map(e=>'<button type="button" class="graphEvidenceButton" data-source="'+escapeHtml(e.sourceId)+'" data-item="'+escapeHtml(e.itemId)+'">Abrir '+escapeHtml(e.sourceId)+':'+escapeHtml(e.itemId)+'</button>').join(" ")+'</div>';detail.querySelectorAll(".graphEvidenceButton").forEach(button=>button.addEventListener("click",()=>openEvidence(button.dataset.source,button.dataset.item)));}));
  };
  draw();
}
const previewCache=new Map();let previewTimer=null,previewAnchor=null;
function hidePreview(){clearTimeout(previewTimer);previewTimer=null;previewAnchor=null;byId("evidencePreview").classList.add("hidden");}
function placePreview(anchor){
  const card=byId("evidencePreview"),rect=anchor.getBoundingClientRect(),width=Math.min(380,window.innerWidth-24);
  card.style.width=width+"px";card.classList.remove("hidden");
  const left=Math.min(Math.max(12,rect.left),window.innerWidth-width-12);
  let top=rect.bottom+8;if(top+card.offsetHeight>window.innerHeight-12)top=Math.max(12,rect.top-card.offsetHeight-8);
  card.style.left=left+"px";card.style.top=top+"px";
}
function renderPreview(anchor,data){
  if(previewAnchor!==anchor)return;
  const card=byId("evidencePreview");
  card.innerHTML=data.error?'<div class="meta">'+escapeHtml(data.error)+'</div>':'<div class="previewName">'+escapeHtml(data.name||"Item")+'</div><div class="meta">'+escapeHtml((data.path?data.path+" · ":"")+data.reference.sourceId+":"+data.reference.itemId)+'</div>'+((data.bookmarks||[]).length?'<div class="previewChips">'+data.bookmarks.map(name=>'<span class="chip">'+escapeHtml(name)+'</span>').join("")+'</div>':"")+(data.excerpt?'<div class="previewText">'+escapeHtml(data.excerpt)+(data.excerptTruncated?"…":"")+'</div>':'<div class="meta">Sem texto extraído.</div>')+'<div class="meta previewHint">Clique para abrir a evidência.</div>';
  placePreview(anchor);
}
document.addEventListener("mouseover",event=>{
  const anchor=event.target.closest?.(".evidenceButton[data-source][data-item]");
  if(!anchor||anchor===previewAnchor)return;
  if(window.matchMedia&&window.matchMedia("(hover: none)").matches)return;
  hidePreview();previewAnchor=anchor;
  previewTimer=setTimeout(async()=>{
    const key=anchor.dataset.source+":"+anchor.dataset.item;
    let data=previewCache.get(key);
    if(!data){
      try{const response=await fetch("/api/evidence/"+encodeURIComponent(anchor.dataset.source)+"/"+encodeURIComponent(anchor.dataset.item)+"?preview=1");data=response.ok?await response.json():{error:"Prévia indisponível."};if(response.ok)previewCache.set(key,data);}
      catch{data={error:"Prévia indisponível."};}
    }
    renderPreview(anchor,data);
  },450);
});
document.addEventListener("mouseout",event=>{const anchor=event.target.closest?.(".evidenceButton[data-source][data-item]");if(anchor&&anchor===previewAnchor&&!anchor.contains(event.relatedTarget))hidePreview();});
document.addEventListener("scroll",hidePreview,true);
document.addEventListener("click",hidePreview,true);
let bookmarkTarget=null;
async function loadBookmarkOptions(){
  try{const response=await fetch("/api/bookmarks");const result=await response.json();byId("bookmarkOptions").innerHTML=(result.bookmarks||[]).map(name=>'<option value="'+escapeHtml(name)+'"></option>').join("");}catch{}
}
function renderBookmarks(sourceId,itemId,list){
  bookmarkTarget={sourceId,itemId};
  const chips=byId("bookmarkChips");
  chips.innerHTML=list.length?list.map(name=>'<span class="chip">'+escapeHtml(name)+'<button type="button" class="chipRemove" data-bookmark="'+escapeHtml(name)+'" title="Remover deste marcador" aria-label="Remover do marcador '+escapeHtml(name)+'">×</button></span>').join(""):'<span class="meta">Este item ainda não está em nenhum marcador.</span>';
  chips.querySelectorAll(".chipRemove").forEach(button=>button.addEventListener("click",()=>changeBookmark(button.dataset.bookmark,true)));
  loadBookmarkOptions();
}
async function changeBookmark(name,remove){
  if(!bookmarkTarget)return;
  const sourceId=bookmarkTarget.sourceId,itemId=bookmarkTarget.itemId,status=byId("bookmarkStatus");
  status.textContent=remove?"Removendo...":"Marcando...";
  try{
    const response=await fetch("/api/evidence/"+encodeURIComponent(sourceId)+"/"+encodeURIComponent(itemId)+"/bookmarks"+(remove?"/remove":""),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({bookmark:name})});
    const result=await response.json();
    if(!response.ok){status.textContent=result.error||"Não foi possível atualizar o marcador.";return;}
    previewCache.delete(sourceId+":"+itemId);
    if(!bookmarkTarget||bookmarkTarget.sourceId!==sourceId||bookmarkTarget.itemId!==itemId)return;
    renderBookmarks(sourceId,itemId,result.bookmarks||[]);
    status.textContent=remove?('Removido de "'+name+'".'):('Marcado em "'+name+'"'+(result.createdBookmark?' (novo marcador criado no IPED).':'.'));
  }catch{status.textContent="Não foi possível atualizar o marcador."}
}
byId("citeEvidence").addEventListener("click",()=>{
  if(!bookmarkTarget||!activeInvestigationId)return;
  const name=byId("evidenceTitle").textContent,reference=bookmarkTarget.sourceId+":"+bookmarkTarget.itemId;
  const insert=reference+(name?" ("+name+")":""),field=byId("noteText");
  field.value=field.value.trim()?field.value.trimEnd()+" "+insert+" ":insert+" ";
  byId("evidenceDrawer").classList.add("hidden");selectTab("notebook");
  field.dispatchEvent(new Event("input"));field.focus();field.setSelectionRange(field.value.length,field.value.length);
  byId("noteStatus").textContent="Referência inserida. Complete a nota e salve.";
});
let caseEvents=[],editingEventId=null,eventsInvestigationId=null;
function formatEventDate(value){
  const parts=String(value||"").split("T");
  return parts[0].split("-").reverse().join("/")+(parts[1]?" "+parts[1]:"");
}
function resetEventForm(){
  editingEventId=null;byId("eventSubmit").textContent="Registrar evento";byId("eventCancel").classList.add("hidden");
  ["eventDate","eventTime","eventDescription","eventEvidence"].forEach(id=>{byId(id).value="";});
  byId("eventApproximate").checked=false;byId("eventDescription").style.height="";
}
function renderEvents(){
  byId("timelineTab").innerHTML="Timeline"+(caseEvents.length?'<span class="tabCount">'+caseEvents.length+'</span>':"");
  const list=byId("eventsList");
  if(!caseEvents.length){list.innerHTML='<div class="empty">Nenhum evento registrado. Ao ler uma evidência, use "Usar em evento" para datar o que ela descreve.</div>';return;}
  list.innerHTML='<ol class="caseTimeline">'+caseEvents.map(e=>'<li class="caseEvent" data-id="'+escapeHtml(e.id)+'"><div class="eventDate">'+escapeHtml(formatEventDate(e.date))+(e.approximate?' <span class="claimBadge HYPOTHESIS">aprox.</span>':"")+'</div><div class="eventBody"><div class="claimStatement">'+escapeHtml(e.description)+'</div><div class="claimRefs"><span class="meta">Lida em: </span>'+refButtons(e.evidence,e.missing)+'</div>'+((e.missing||[]).length?'<div class="claimCheck warn">'+escapeHtml(e.missing.length)+' referência(s) não encontrada(s) no caso.</div>':"")+'<span class="noteActions"><button type="button" class="linkBtn eventEdit">Editar</button><button type="button" class="linkBtn eventDelete">Excluir</button></span></div></li>').join("")+'</ol>';
  list.querySelectorAll(".claimRef").forEach(button=>button.addEventListener("click",()=>openEvidence(button.dataset.source,button.dataset.item)));
  list.querySelectorAll(".caseEvent").forEach(item=>{
    const ev=caseEvents.find(e=>e.id===item.dataset.id);
    item.querySelector(".eventEdit").addEventListener("click",()=>{
      editingEventId=ev.id;const parts=ev.date.split("T");
      byId("eventDate").value=parts[0];byId("eventTime").value=parts[1]||"";byId("eventApproximate").checked=Boolean(ev.approximate);
      byId("eventDescription").value=ev.description;byId("eventEvidence").value=refsText(ev.evidence);
      byId("eventSubmit").textContent="Salvar alteração";byId("eventCancel").classList.remove("hidden");
      byId("eventStatus").textContent="Editando evento.";byId("eventDescription").focus();
    });
    const remove=item.querySelector(".eventDelete");
    remove.addEventListener("click",()=>{
      if(remove.dataset.confirm!=="1"){remove.dataset.confirm="1";remove.textContent="Confirmar exclusão";setTimeout(()=>{remove.dataset.confirm="";remove.textContent="Excluir";},4000);return;}
      eventRequest("/"+encodeURIComponent(ev.id)+"/delete",{},"Evento excluído.",ev.id);
    });
  });
}
async function eventRequest(suffix,payload,message,deletedId){
  const id=activeInvestigationId;if(!id)return false;
  try{
    const response=await fetch("/api/investigations/"+encodeURIComponent(id)+"/events"+suffix,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
    const result=await response.json();
    if(!response.ok){byId("eventStatus").textContent=result.error||"Não foi possível salvar o evento.";return false;}
    if(deletedId){caseEvents=caseEvents.filter(e=>e.id!==deletedId);if(editingEventId===deletedId)resetEventForm();}
    else if(caseEvents.some(e=>e.id===result.event.id))caseEvents=caseEvents.map(e=>e.id===result.event.id?result.event:e);
    else caseEvents.push(result.event);
    caseEvents.sort((a,b)=>a.date.localeCompare(b.date)||a.createdAt.localeCompare(b.createdAt));
    byId("eventStatus").textContent=message;renderEvents();return true;
  }catch{byId("eventStatus").textContent="Não foi possível salvar o evento.";return false;}
}
async function loadEvents(id){
  eventsInvestigationId=id;caseEvents=[];resetEventForm();byId("eventStatus").textContent="";renderEvents();
  if(!id)return;
  try{const response=await fetch("/api/investigations/"+encodeURIComponent(id)+"/events");if(response.ok&&eventsInvestigationId===id){caseEvents=(await response.json()).events||[];renderEvents();}}catch{}
}
byId("eventCancel").addEventListener("click",()=>{resetEventForm();byId("eventStatus").textContent="";});
byId("eventForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const evidence=parseReferences(byId("eventEvidence").value);
  if(evidence.unknown.length){byId("eventStatus").textContent="Referência não reconhecida: "+evidence.unknown.join(", ")+". Use o formato fonte:item, como "+(referenceSources()[0]||"fonte")+":8.";return;}
  const day=byId("eventDate").value,time=byId("eventTime").value;
  if(!day){byId("eventStatus").textContent="Informe a data do evento.";return;}
  const payload={date:time?day+"T"+time:day,approximate:byId("eventApproximate").checked,description:byId("eventDescription").value,evidence:evidence.refs};
  byId("eventSubmit").disabled=true;byId("eventStatus").textContent="Conferindo evidências no IPED...";
  const ok=await eventRequest(editingEventId?"/"+encodeURIComponent(editingEventId):"",payload,editingEventId?"Evento atualizado.":"Evento registrado.");
  byId("eventSubmit").disabled=false;
  if(ok)resetEventForm();
});
byId("eventFromEvidence").addEventListener("click",()=>{
  if(!bookmarkTarget||!activeInvestigationId)return;
  const reference=bookmarkTarget.sourceId+":"+bookmarkTarget.itemId,field=byId("eventEvidence");
  const current=field.value.split(",").map(item=>item.trim()).filter(Boolean);
  if(!current.includes(reference))current.push(reference);
  field.value=current.join(", ");
  byId("evidenceDrawer").classList.add("hidden");selectTab("timeline");byId("eventDate").focus();
  byId("eventStatus").textContent="Evidência adicionada. Informe a data lida no conteúdo e descreva o evento.";
});
byId("claimEvidence").addEventListener("click",()=>{
  if(!bookmarkTarget||!activeInvestigationId)return;
  const reference=bookmarkTarget.sourceId+":"+bookmarkTarget.itemId,field=byId("claimSupporting");
  const current=field.value.split(",").map(item=>item.trim()).filter(Boolean);
  if(!current.includes(reference))current.push(reference);
  field.value=current.join(", ");
  byId("evidenceDrawer").classList.add("hidden");selectTab("claims");byId("claimStatement").focus();
  byId("claimStatus").textContent='Evidência adicionada em "Evidências a favor". Escreva a afirmação e registre.';
});
byId("bookmarkForm").addEventListener("submit",event=>{event.preventDefault();const name=byId("bookmarkName").value.trim();if(name)changeBookmark(name,false);});
async function openEvidence(sourceId,itemId){
  byId("evidenceDrawer").classList.remove("hidden");
  byId("evidenceTitle").textContent="Carregando...";
  byId("evidenceText").innerHTML='<div class="empty">Consultando evidência...</div>';
  byId("evidenceProperties").innerHTML="";
  bookmarkTarget=null;byId("bookmarkChips").innerHTML='<span class="meta">Carregando...</span>';byId("bookmarkStatus").textContent="";
  try{
    const response=await fetch("/api/evidence/"+encodeURIComponent(sourceId)+"/"+encodeURIComponent(itemId));
    const evidence=await response.json();
    byId("evidenceTitle").textContent=evidence.name||("Item "+itemId);
    byId("evidenceMeta").textContent=(evidence.path||"")+" · "+sourceId+":"+itemId+(evidence.hash?" · hash "+evidence.hash:"");
    renderBookmarks(sourceId,itemId,evidence.bookmarks||[]);
    let evidenceTextHtml='<div class="empty">Texto extraído não disponível.</div>';
    if(evidence.text){
      evidenceTextHtml='<div class="evidenceText">'+escapeHtml(evidence.text)+'</div>';
      if(evidence.textTruncated){
        evidenceTextHtml+='<div class="meta">Texto limitado para visualização.</div>';
      }
    }
    byId("evidenceText").innerHTML=evidenceTextHtml;
    byId("evidenceProperties").innerHTML=(evidence.properties||[]).map(p=>'<div class="property"><b>'+escapeHtml(p.name)+'</b><div class="meta">'+escapeHtml((p.values||[]).join(" · "))+'</div></div>').join("");
  }catch{byId("evidenceTitle").textContent="Evidência";byId("evidenceText").innerHTML='<div class="empty">Não foi possível carregar esta evidência.</div>'}
}
byId("closeEvidence").addEventListener("click",()=>byId("evidenceDrawer").classList.add("hidden"));
async function loadHome(){
  try{
    const selected=byId("sourceSelect").value;
    const response=await fetch("/api/home"+(selected?"?sourceId="+encodeURIComponent(selected):""));
    const home=await response.json();
    const sources=home.sourceSelection?.sources||home.sources||[];
    const selectionStatus=home.sourceSelection?.status;
    const ready=home.status==="READY"&&selectionStatus!=="SOURCE_SELECTION_REQUIRED"&&selectionStatus!=="NO_SOURCES";
    if(sources.length>1){
      byId("caseBar").classList.remove("hidden");
      const current=home.sourceId||selected;
      selectedSourceId=current||undefined;
      byId("sourceSelect").innerHTML='<option value="">Selecione a fonte...</option>'+sources.map((s,index)=>'<option value="'+escapeHtml(s.id)+'"'+(s.id===current?' selected':'')+'>'+escapeHtml(s.label||("Fonte "+(index+1)))+'</option>').join("");
    }else{
      byId("caseBar").classList.add("hidden");
      selectedSourceId=home.sourceId||sources[0]?.id;
    }
    byId("connection").textContent=ready?"IPED conectado":(selectionStatus==="SOURCE_SELECTION_REQUIRED"?"IPED conectado · selecione uma fonte":"IPED não disponível");
    byId("connDot").classList.toggle("ok",ready);
    byId("startButton").disabled=!ready;
    if(!ready){byId("status").textContent=selectionStatus==="SOURCE_SELECTION_REQUIRED"?"Há mais de uma fonte neste caso. Selecione qual deseja investigar.":"Conecte um caso IPED já processado.";if(selectionStatus!=="SOURCE_SELECTION_REQUIRED")byId("onboarding").classList.remove("hidden");}
    else byId("status").textContent="";
    if(ready)loadSavedInvestigations();
  }catch{byId("connection").textContent="IPED não disponível";byId("startButton").disabled=true;byId("status").textContent="Conecte um caso IPED já processado.";byId("onboarding").classList.remove("hidden")}
}
byId("sourceSelect").addEventListener("change",loadHome);
function startProgress(initial){
  const id=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():"";
  const startedAt=Date.now();let stopped=false,last=null;
  const show=()=>{
    if(stopped)return;
    let text=(last&&last.phase?last.phase:initial)+" · "+Math.round((Date.now()-startedAt)/1000)+" s";
    if(last&&(last.searches||last.itemsRead))text+=" · "+last.searches+" busca(s) no índice · "+last.itemsRead+" consulta(s) a evidências";
    byId("status").textContent=text;
  };
  const poll=async()=>{
    if(!id||stopped)return;
    try{const r=await fetch("/api/progress/"+id,{cache:"no-store"});if(r.ok&&!stopped){last=await r.json();show();}}catch{}
  };
  show();const timer=setInterval(()=>{show();poll();},1000);
  const headers={"content-type":"application/json"};if(id)headers["x-progress-id"]=id;
  return {headers,stop(){
    if(stopped)return;stopped=true;clearInterval(timer);
    let text="Concluído em "+Math.round((Date.now()-startedAt)/1000)+" s";
    if(last&&(last.searches||last.itemsRead))text+=" · "+last.searches+" busca(s) no índice · "+last.itemsRead+" consulta(s) a evidências";
    byId("status").textContent=text;
  }};
}
async function updateInvestigation(path,payload){
  if(!activeInvestigationId)return;
  const leadButtons=[...document.querySelectorAll(".leadButton")];
  const followUpButton=byId("followUpForm")?.querySelector("button");
  leadButtons.forEach(button=>{button.disabled=true;if(path==="/leads")button.textContent="Buscando...";});
  if(followUpButton)followUpButton.disabled=true;
  const run=startProgress("Buscando evidências relacionadas no IPED");
  try{
    const response=await fetch("/api/investigations/"+encodeURIComponent(activeInvestigationId)+path,{method:"POST",headers:run.headers,body:JSON.stringify(payload)});
    const result=await response.json();run.stop();
    if(result.workspace){
      renderWorkspace(result.workspace);
      if(result.status==="LEAD_EXPLORED"){
        const label=result.exploredLead?.value??"";
        const found=result.newEvidenceCount||0;
        byId("status").textContent='Exploração de "'+label+'" concluída: '+(found>0?found+' nova(s) evidência(s) incorporada(s) à investigação.':'nenhuma evidência nova além do que já estava na investigação.');
        const leadRow=[...document.querySelectorAll(".item")].find(el=>el.dataset.leadType===result.exploredLead?.type&&el.dataset.leadValue===result.exploredLead?.value);
        const leadBadge=leadRow?.querySelector(".leadStatusBadge");
        if(leadBadge)leadBadge.textContent=found>0?("+"+found+" nova(s)"):"sem evidência nova";
        if(found>0)leadRow?.classList.add("newEvidence");
        const newKeys=new Set((result.newEvidence||[]).map(e=>e.sourceId+":"+e.itemId));
        if(newKeys.size){
          document.querySelectorAll(".evidenceButton").forEach(button=>{
            if(newKeys.has(button.dataset.source+":"+button.dataset.item))button.closest(".item")?.classList.add("newEvidence");
          });
          selectTab("evidence");
        }
      }
    }
    else if(result.status==="CORRELATION_NOT_AVAILABLE"){
      byId("status").textContent="Esta correlação já não está disponível para exploração. A investigação não foi alterada.";
      await loadHome();
    }else byId("status").textContent=result.error||result.reason||"A investigação não pôde avançar.";
  }catch{run.stop();byId("status").textContent="Não foi possível continuar a investigação."}
  finally{
    run.stop();
    leadButtons.forEach(button=>{button.disabled=false;if(path==="/leads")button.textContent="Explorar";});
    if(followUpButton)followUpButton.disabled=false;
  }
}
async function exploreLead(leadType,leadValue){
  await updateInvestigation("/leads",{leadType,leadValue});
}
byId("followUpForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const question=byId("followUp").value.trim();if(!question)return;
  byId("followUp").value="";byId("followUp").style.height="";
  const entry=investigationHistory.get(activeInvestigationId);if(entry){entry.questions.push(question);renderThread(entry);}
  await updateInvestigation("/questions",{question});
});
byId("questionForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const question=byId("question").value.trim(); if(!question)return;
  byId("startButton").disabled=true;
  const emptyState=byId("mainEmptyState"),idleText=emptyState.textContent;
  const run=startProgress("Investigando evidências");
  if(!activeInvestigationId)emptyState.textContent="Investigando evidências no IPED. Com a análise assistida por IA ativa, isso pode levar alguns minutos.";
  try{
    const response=await fetch("/api/investigations",{method:"POST",headers:run.headers,body:JSON.stringify({question,sourceId:selectedSourceId||undefined})});
    const result=await response.json();run.stop();
    if(result.workspace){renderWorkspace(result.workspace);selectTab("resumo");}
    else if(result.sourceSelection) byId("status").textContent="Selecione uma fonte do caso para continuar.";
    else byId("status").textContent=result.error||"Não foi possível iniciar a investigação.";
  }catch{run.stop();byId("status").textContent="Não foi possível iniciar a investigação."}
  finally{run.stop();byId("startButton").disabled=false;if(!activeInvestigationId)emptyState.textContent=idleText;}
});
["question","followUp","noteText"].forEach(id=>{
  const field=byId(id);if(!field)return;
  const grow=()=>{field.style.height="auto";field.style.height=field.scrollHeight+2+"px";};
  field.addEventListener("input",grow);
  field.addEventListener("keydown",event=>{if(event.key==="Enter"&&(event.metaKey||event.ctrlKey)){event.preventDefault();field.form?.requestSubmit();}});
});
function selectTab(tab){
  document.querySelectorAll(".tabButton").forEach(b=>b.classList.toggle("tabActive",b.dataset.tab===tab));
  document.querySelectorAll(".tabPanel").forEach(p=>p.classList.toggle("hidden",p.dataset.tabPanel!==tab));
  if(tab==="relationships")requestAnimationFrame(()=>document.querySelector('[data-graph-action="fit"]')?.click());
}
document.querySelectorAll(".tabButton").forEach(b=>b.addEventListener("click",()=>selectTab(b.dataset.tab)));
loadHome();
</script>
</body>
</html>`;

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

/**
 * Guards state-changing requests from the local UI. Requires a JSON body
 * (cross-site pages cannot send it without a CORS preflight, which this server
 * never grants), a loopback Host (blocks DNS rebinding) and, when the browser
 * sends one, an Origin matching that Host.
 */
export function isTrustedLocalWrite(headers: IncomingMessage["headers"]): boolean {
  const contentType = String(headers["content-type"] ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) return false;
  const host = String(headers.host ?? "").toLowerCase();
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return false;
  const origin = headers.origin;
  if (origin !== undefined && String(origin).toLowerCase() !== `http://${host}`) return false;
  return true;
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) return {};

  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object");
  }

  return value as Record<string, unknown>;
}

const server = createServer((request, response) => trackProgress(request, () => handle(request, response)));

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    const progressMatch = url.pathname.match(/^\/api\/progress\/([^/]+)$/);
    if (request.method === "GET" && progressMatch) {
      const state = progress.get(decodeURIComponent(progressMatch[1]).toLowerCase());
      if (!state) return json(response, 404, { error: "Progresso não encontrado." });
      return json(response, 200, { ...state, elapsedMs: Date.now() - state.startedAt });
    }

    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end(investigatorHtml);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/home") {
      const sourceId = url.searchParams.get("sourceId") ?? undefined;
      const investigationId =
        url.searchParams.get("investigationId") ?? undefined;

      return json(
        response,
        200,
        await investigator.home(sourceId, investigationId)
      );
    }

    if (request.method === "POST" && url.pathname === "/api/investigations") {
      const input = await body(request);
      const question =
        typeof input.question === "string" ? input.question.trim() : "";
      const sourceId =
        typeof input.sourceId === "string" ? input.sourceId : undefined;

      if (!question) {
        return json(response, 400, {
          error: "A pergunta da investigação é obrigatória."
        });
      }

      return json(
        response,
        200,
        await persist(await investigator.begin(question, sourceId))
      );
    }

    const diagnosticMatch = url.pathname.match(
      /^\/api\/investigations\/([^/]+)\/ai-diagnostic$/
    );
    if (
      request.method === "GET" &&
      diagnosticMatch &&
      process.env.INVESTIGATOR_DEBUG === "1"
    ) {
      return json(
        response,
        200,
        await investigator.aiDiagnostic(
          decodeURIComponent(diagnosticMatch[1])
        )
      );
    }

    const evidenceMatch = url.pathname.match(
      /^\/api\/evidence\/([^/]+)\/(\d+)$/
    );
    if (request.method === "GET" && evidenceMatch) {
      const sourceId = decodeURIComponent(evidenceMatch[1]);
      const itemId = Number(evidenceMatch[2]);
      if (url.searchParams.get("preview") === "1") {
        const evidence = await investigator.evidence(sourceId, itemId, "preview");
        const text = typeof evidence.text === "string" ? evidence.text : "";
        return json(response, 200, {
          reference: evidence.reference,
          name: evidence.name,
          path: evidence.path,
          hash: evidence.hash,
          bookmarks: evidence.bookmarks,
          excerpt: text.trim().slice(0, 420),
          excerptTruncated: text.trim().length > 420 || Boolean(evidence.textTruncated)
        });
      }
      return json(response, 200, await investigator.evidence(sourceId, itemId));
    }

    const continueMatch = url.pathname.match(
      /^\/api\/investigations\/([^/]+)\/questions$/
    );
    if (request.method === "POST" && continueMatch) {
      const input = await body(request);
      const question =
        typeof input.question === "string" ? input.question.trim() : "";
      const focus =
        typeof input.focus === "string" ? input.focus.trim() : undefined;

      if (!question) {
        return json(response, 400, {
          error: "A pergunta da investigação é obrigatória."
        });
      }

      return json(
        response,
        200,
        await persist(
          await investigator.continue(
            decodeURIComponent(continueMatch[1]),
            question,
            focus
          )
        )
      );
    }

    const leadMatch = url.pathname.match(
      /^\/api\/investigations\/([^/]+)\/leads$/
    );
    if (request.method === "POST" && leadMatch) {
      const input = await body(request);
      const leadType =
        typeof input.leadType === "string" ? input.leadType : undefined;
      const leadValue =
        typeof input.leadValue === "string" ? input.leadValue : undefined;

      const result = await persist(
        await investigator.exploreLead(
          decodeURIComponent(leadMatch[1]),
          leadType,
          leadValue
        )
      );
      return json(
        response,
        result.status === "CORRELATION_NOT_AVAILABLE" ? 409 : 200,
        result
      );
    }

    const reportMatch = url.pathname.match(/^\/api\/investigations\/([^/]+)\/report$/);
    if (request.method === "GET" && reportMatch) {
      const investigationId = decodeURIComponent(reportMatch[1]);
      const record = isInvestigationId(investigationId)
        ? await investigationStore.load(investigationId)
        : undefined;
      if (!record) return json(response, 404, { error: "Investigação não encontrada." });

      const workspaceEvidence =
        ((record.workspace as { panels?: { evidence?: Array<{ sourceId?: string }> } })?.panels?.evidence ?? []);
      const sourceIds = [
        ...new Set(
          [record.sourceId, ...workspaceEvidence.map(item => item.sourceId)].filter(
            (value): value is string => typeof value === "string" && value.length > 0
          )
        )
      ];
      const references = collectReferences(record, sourceIds).slice(0, 300);
      const evidence: ReportEvidence[] = [];
      for (let index = 0; index < references.length; index += 8) {
        evidence.push(
          ...(await Promise.all(
            references.slice(index, index + 8).map(async reference => {
              try {
                const item = await iped.getEvidence(reference.sourceId, reference.itemId);
                const props = item.properties;
                return {
                  ...reference,
                  found: true,
                  name: props.name?.[0] ?? props.Name?.[0],
                  path: props.path?.[0] ?? props.Path?.[0],
                  hash: props.hash?.[0],
                  bookmarks: item.bookmarks
                };
              } catch {
                return { ...reference, found: false };
              }
            })
          ))
        );
      }

      const referenceKeys = new Set(references.map(ref => `${ref.sourceId}:${ref.itemId}`));
      const auditEntries: ReportAuditEntry[] = [];
      try {
        const lines = config.auditLog ? (await readFile(config.auditLog, "utf8")).split("\n") : [];
        for (const line of lines) {
          if (!line.trim()) continue;
          let entry: Record<string, unknown>;
          try {
            entry = JSON.parse(line);
          } catch {
            continue;
          }
          const ownInvestigation = entry.investigationId === record.id;
          const bookmarkOnCitedItem =
            typeof entry.action === "string" &&
            entry.action.startsWith("examiner_bookmark_") &&
            referenceKeys.has(`${entry.sourceId}:${entry.itemId}`) &&
            String(entry.timestamp) >= record.createdAt;
          if (!ownInvestigation && !bookmarkOnCitedItem) continue;
          const details = Object.entries(entry)
            .filter(([key]) => !["timestamp", "serverSessionId", "sequence", "action", "investigationId"].includes(key))
            .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
            .join(" · ");
          auditEntries.push({ timestamp: String(entry.timestamp), action: String(entry.action), details });
        }
      } catch {
        // A missing audit log yields an empty traceability section.
      }

      const generatedAt = new Date().toISOString();
      await audit.write("investigation_report_exported", {
        investigationId: record.id,
        referencedEvidence: evidence.length,
        claims: record.claims?.length ?? 0,
        events: record.events?.length ?? 0,
        notes: record.notes?.length ?? 0
      });
      const html = buildReportHtml({ record, evidence, audit: auditEntries, generatedAt });
      const fileDate = generatedAt.slice(0, 10);
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="rascunho-relatorio-${fileDate}-${record.id.slice(0, 8)}.html"`
      });
      response.end(html);
      return;
    }

    const claimsMatch = url.pathname.match(
      /^\/api\/investigations\/([^/]+)\/claims(?:\/([^/]+)(\/delete|\/verify)?)?$/
    );
    if (claimsMatch) {
      const investigationId = decodeURIComponent(claimsMatch[1]);
      const claimId = claimsMatch[2] ? decodeURIComponent(claimsMatch[2]) : undefined;
      const action = claimsMatch[3];
      if (!isInvestigationId(investigationId)) {
        return json(response, 404, { error: "Investigação não encontrada." });
      }

      if (request.method === "GET" && !claimId) {
        const claims = await investigationStore.listClaims(investigationId);
        if (!claims) return json(response, 404, { error: "Investigação não encontrada." });
        return json(response, 200, { claims });
      }

      if (request.method === "POST") {
        if (!isTrustedLocalWrite(request.headers)) {
          await audit.write("investigation_claim_rejected", {
            reason: "untrusted_request",
            origin: request.headers.origin,
            host: request.headers.host
          });
          return json(response, 403, { error: "Requisição não permitida." });
        }
        const input = await body(request);
        const auditClaim = (claim: Claim) => ({
          investigationId,
          claimId: claim.id,
          classification: claim.classification,
          supporting: claim.supporting.length,
          contradicting: claim.contradicting.length,
          warnings: claim.verification?.warnings.length ?? 0
        });
        try {
          if (!claimId) {
            const claim = normalizeClaimInput(input);
            const created = await investigationStore.addClaim(
              investigationId,
              claim,
              await verifyClaim(iped, claim)
            );
            if (!created) return json(response, 404, { error: "Investigação não encontrada." });
            await audit.write("investigation_claim_added", auditClaim(created));
            return json(response, 200, { claim: created });
          }
          if (action === "/delete") {
            const deleted = await investigationStore.deleteClaim(investigationId, claimId);
            if (!deleted) return json(response, 404, { error: "Afirmação não encontrada." });
            await audit.write("investigation_claim_deleted", { investigationId, claimId });
            return json(response, 200, { deleted: true });
          }
          if (action === "/verify") {
            const current = await investigationStore.getClaim(investigationId, claimId);
            if (!current) return json(response, 404, { error: "Afirmação não encontrada." });
            const verified = await investigationStore.updateClaim(
              investigationId,
              claimId,
              undefined,
              await verifyClaim(iped, current)
            );
            if (!verified) return json(response, 404, { error: "Afirmação não encontrada." });
            await audit.write("investigation_claim_verified", auditClaim(verified));
            return json(response, 200, { claim: verified });
          }
          const claim = normalizeClaimInput(input);
          const updated = await investigationStore.updateClaim(
            investigationId,
            claimId,
            claim,
            await verifyClaim(iped, claim)
          );
          if (!updated) return json(response, 404, { error: "Afirmação não encontrada." });
          await audit.write("investigation_claim_updated", auditClaim(updated));
          return json(response, 200, { claim: updated });
        } catch (error) {
          if (error instanceof ClaimInputError) {
            return json(response, 400, { error: error.message });
          }
          throw error;
        }
      }
    }

    const eventsMatch = url.pathname.match(
      /^\/api\/investigations\/([^/]+)\/events(?:\/([^/]+)(\/delete)?)?$/
    );
    if (eventsMatch) {
      const investigationId = decodeURIComponent(eventsMatch[1]);
      const eventId = eventsMatch[2] ? decodeURIComponent(eventsMatch[2]) : undefined;
      const remove = Boolean(eventsMatch[3]);
      if (!isInvestigationId(investigationId)) {
        return json(response, 404, { error: "Investigação não encontrada." });
      }

      if (request.method === "GET" && !eventId) {
        const events = await investigationStore.listEvents(investigationId);
        if (!events) return json(response, 404, { error: "Investigação não encontrada." });
        return json(response, 200, { events });
      }

      if (request.method === "POST") {
        if (!isTrustedLocalWrite(request.headers)) {
          await audit.write("investigation_event_rejected", {
            reason: "untrusted_request",
            origin: request.headers.origin,
            host: request.headers.host
          });
          return json(response, 403, { error: "Requisição não permitida." });
        }
        const input = await body(request);
        try {
          if (eventId && remove) {
            const deleted = await investigationStore.deleteEvent(investigationId, eventId);
            if (!deleted) return json(response, 404, { error: "Evento não encontrado." });
            await audit.write("investigation_event_deleted", { investigationId, eventId });
            return json(response, 200, { deleted: true });
          }
          const event = normalizeEventInput(input);
          const missing = await missingEventEvidence(iped, event);
          const saved = eventId
            ? await investigationStore.updateEvent(investigationId, eventId, event, missing)
            : await investigationStore.addEvent(investigationId, event, missing);
          if (!saved) return json(response, 404, { error: eventId ? "Evento não encontrado." : "Investigação não encontrada." });
          await audit.write(eventId ? "investigation_event_updated" : "investigation_event_added", {
            investigationId,
            eventId: saved.id,
            date: saved.date,
            evidence: saved.evidence.length,
            missing: missing.length
          });
          return json(response, 200, { event: saved });
        } catch (error) {
          if (error instanceof CaseEventInputError) {
            return json(response, 400, { error: error.message });
          }
          throw error;
        }
      }
    }

    const notesMatch = url.pathname.match(
      /^\/api\/investigations\/([^/]+)\/notes(?:\/([^/]+)(\/delete)?)?$/
    );
    if (notesMatch) {
      const investigationId = decodeURIComponent(notesMatch[1]);
      const noteId = notesMatch[2] ? decodeURIComponent(notesMatch[2]) : undefined;
      const remove = Boolean(notesMatch[3]);
      if (!isInvestigationId(investigationId)) {
        return json(response, 404, { error: "Investigação não encontrada." });
      }

      if (request.method === "GET" && !noteId) {
        const notes = await investigationStore.listNotes(investigationId);
        if (!notes) return json(response, 404, { error: "Investigação não encontrada." });
        return json(response, 200, { notes });
      }

      if (request.method === "POST") {
        if (!isTrustedLocalWrite(request.headers)) {
          await audit.write("investigation_note_rejected", {
            reason: "untrusted_request",
            origin: request.headers.origin,
            host: request.headers.host
          });
          return json(response, 403, { error: "Requisição não permitida." });
        }
        const input = await body(request);
        try {
          if (!noteId) {
            const note = await investigationStore.addNote(investigationId, input.text);
            if (!note) return json(response, 404, { error: "Investigação não encontrada." });
            await audit.write("investigation_note_added", {
              investigationId,
              noteId: note.id,
              length: note.text.length
            });
            return json(response, 200, { note });
          }
          if (remove) {
            const deleted = await investigationStore.deleteNote(investigationId, noteId);
            if (!deleted) return json(response, 404, { error: "Nota não encontrada." });
            await audit.write("investigation_note_deleted", { investigationId, noteId });
            return json(response, 200, { deleted: true });
          }
          const note = await investigationStore.updateNote(investigationId, noteId, input.text);
          if (!note) return json(response, 404, { error: "Nota não encontrada." });
          await audit.write("investigation_note_updated", {
            investigationId,
            noteId,
            length: note.text.length
          });
          return json(response, 200, { note });
        } catch (error) {
          if (error instanceof NoteInputError) {
            return json(response, 400, { error: error.message });
          }
          throw error;
        }
      }
    }

    if (request.method === "GET" && url.pathname === "/api/investigations") {
      const sourceId = url.searchParams.get("sourceId") ?? undefined;
      return json(response, 200, {
        investigations: await investigationStore.list(sourceId)
      });
    }

    const savedMatch = url.pathname.match(/^\/api\/investigations\/([^/]+)$/);
    if (request.method === "GET" && savedMatch) {
      const id = decodeURIComponent(savedMatch[1]);
      const record = isInvestigationId(id) ? await investigationStore.load(id) : undefined;
      if (!record) {
        return json(response, 404, { error: "Investigação não encontrada." });
      }
      investigations.restore(record.state);
      await audit.write("investigation_reopened", {
        investigationId: record.id,
        sourceId: record.sourceId
      });
      return json(response, 200, {
        investigationId: record.id,
        questions: record.questions,
        updatedAt: record.updatedAt,
        workspace: record.workspace
      });
    }

    if (request.method === "GET" && url.pathname === "/api/bookmarks") {
      return json(response, 200, { bookmarks: await examinerBookmarks.list() });
    }

    const bookmarkMatch = url.pathname.match(
      /^\/api\/evidence\/([^/]+)\/(\d+)\/bookmarks(\/remove)?$/
    );
    if (request.method === "POST" && bookmarkMatch) {
      if (!isTrustedLocalWrite(request.headers)) {
        await audit.write("examiner_bookmark_rejected", {
          reason: "untrusted_request",
          origin: request.headers.origin,
          host: request.headers.host
        });
        return json(response, 403, { error: "Requisição não permitida." });
      }
      const input = await body(request);
      const sourceId = decodeURIComponent(bookmarkMatch[1]);
      const itemId = Number(bookmarkMatch[2]);
      try {
        const result = bookmarkMatch[3]
          ? await examinerBookmarks.unmark(sourceId, itemId, input.bookmark)
          : await examinerBookmarks.mark(sourceId, itemId, input.bookmark);
        const evidence = await investigator.evidence(sourceId, itemId);
        return json(response, 200, { ...result, bookmarks: evidence.bookmarks ?? [] });
      } catch (error) {
        if (error instanceof BookmarkInputError) {
          return json(response, 400, { error: error.message });
        }
        if (error instanceof BookmarkConflictError) {
          return json(response, 409, { error: error.message, conflict: true });
        }
        throw error;
      }
    }

    return json(response, 404, { error: "Not found" });
  } catch (error) {
    await audit.write("investigator_http_failed", {
      method: request.method,
      url: request.url,
      error: error instanceof Error ? error.message : String(error)
    });

    return json(response, 500, {
      error: "Não foi possível concluir a operação."
    });
  }
}

const isEntryPoint =
  !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(
      `IPED MCP available at http://127.0.0.1:${port}\n`
    );
  });
}
