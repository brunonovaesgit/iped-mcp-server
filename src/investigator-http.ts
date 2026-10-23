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

const config = getConfig();
const audit = new AuditLog(config.auditLog);
const iped = new IpedClient(config);
const investigations = new InvestigationSessions();
const ai = createAiAnalyzer({
  baseUrl: config.aiBaseUrl,
  model: config.aiModel,
  apiKey: config.aiApiKey
});
const investigator = new InvestigatorService(iped, investigations, audit, ai);
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
    <div class="navSection">Investigações desta sessão</div>
    <div class="history" id="history"><div class="historyEmpty">Nenhuma investigação ainda.</div></div>
    <div class="navBottom">
      <div id="caseBar" class="caseBar hidden"><label for="sourceSelect">Fonte do caso</label><select id="sourceSelect"></select></div>
      <div class="conn"><span class="dot" id="connDot"></span><span id="connection">Conectando ao IPED...</span></div>
      <div class="navNote">Acesso somente leitura. O histórico existe apenas enquanto esta página estiver aberta.</div>
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
          <div class="answerHead"><span class="avatar">IPED</span><span>Resultado da investigação</span></div>
          <div class="summary" id="summary"></div>
          <div class="tabBar">
            <button type="button" class="tabButton tabActive" data-tab="resumo">Resumo</button>
            <button type="button" class="tabButton" data-tab="evidence">Evidências</button>
            <button type="button" class="tabButton" data-tab="relationships">Relações</button>
            <button type="button" class="tabButton" data-tab="timeline">Timeline</button>
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
              <div class="panel"><h2>Linha do tempo</h2><div id="timeline"></div></div>
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
<aside id="evidenceDrawer" class="drawer hidden">
  <div class="drawerHeader"><div><div class="meta">Evidência IPED</div><h2 id="evidenceTitle"></h2></div><button id="closeEvidence">Fechar</button></div>
  <div id="evidenceMeta" class="meta"></div>
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
  target.querySelectorAll(".historyItem").forEach(button=>button.addEventListener("click",()=>{const entry=investigationHistory.get(button.dataset.id);if(entry){renderWorkspace(entry.workspace);selectTab("resumo");byId("mainArea").scrollTop=0;}}));
}
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
async function openEvidence(sourceId,itemId){
  byId("evidenceDrawer").classList.remove("hidden");
  byId("evidenceTitle").textContent="Carregando...";
  byId("evidenceText").innerHTML='<div class="empty">Consultando evidência...</div>';
  byId("evidenceProperties").innerHTML="";
  try{
    const response=await fetch("/api/evidence/"+encodeURIComponent(sourceId)+"/"+encodeURIComponent(itemId));
    const evidence=await response.json();
    byId("evidenceTitle").textContent=evidence.name||("Item "+itemId);
    byId("evidenceMeta").textContent=(evidence.path||"")+" · "+sourceId+":"+itemId+(evidence.hash?" · hash "+evidence.hash:"");
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
  }catch{byId("connection").textContent="IPED não disponível";byId("startButton").disabled=true;byId("status").textContent="Conecte um caso IPED já processado.";byId("onboarding").classList.remove("hidden")}
}
byId("sourceSelect").addEventListener("change",loadHome);
async function updateInvestigation(path,payload){
  if(!activeInvestigationId)return;
  const leadButtons=[...document.querySelectorAll(".leadButton")];
  const followUpButton=byId("followUpForm")?.querySelector("button");
  leadButtons.forEach(button=>{button.disabled=true;if(path==="/leads")button.textContent="Buscando...";});
  if(followUpButton)followUpButton.disabled=true;
  byId("status").textContent="Buscando evidências relacionadas no IPED. Isso pode levar alguns segundos...";
  try{
    const response=await fetch("/api/investigations/"+encodeURIComponent(activeInvestigationId)+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
    const result=await response.json();
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
  }catch{byId("status").textContent="Não foi possível continuar a investigação."}
  finally{
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
  const startedAt=Date.now(),emptyState=byId("mainEmptyState"),idleText=emptyState.textContent;
  const tick=()=>{byId("status").textContent="Investigando evidências... "+Math.round((Date.now()-startedAt)/1000)+" s"+(document.body.classList.contains("landing")?" · com a análise assistida por IA ativa, pode levar alguns minutos":"");};
  tick();const timer=setInterval(tick,1000);
  if(!activeInvestigationId)emptyState.textContent="Investigando evidências no IPED. Com a análise assistida por IA ativa, isso pode levar alguns minutos.";
  try{
    const response=await fetch("/api/investigations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({question,sourceId:selectedSourceId||undefined})});
    const result=await response.json();
    if(result.workspace){renderWorkspace(result.workspace);selectTab("resumo");}
    else if(result.sourceSelection) byId("status").textContent="Selecione uma fonte do caso para continuar.";
    else byId("status").textContent=result.error||"Não foi possível iniciar a investigação.";
  }catch{byId("status").textContent="Não foi possível iniciar a investigação."}
  finally{clearInterval(timer);byId("startButton").disabled=false;if(!activeInvestigationId)emptyState.textContent=idleText;}
});
["question","followUp"].forEach(id=>{
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

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

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
        await investigator.begin(question, sourceId)
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
      return json(
        response,
        200,
        await investigator.evidence(
          decodeURIComponent(evidenceMatch[1]),
          Number(evidenceMatch[2])
        )
      );
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
        await investigator.continue(
          decodeURIComponent(continueMatch[1]),
          question,
          focus
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

      const result = await investigator.exploreLead(
        decodeURIComponent(leadMatch[1]),
        leadType,
        leadValue
      );
      return json(
        response,
        result.status === "CORRELATION_NOT_AVAILABLE" ? 409 : 200,
        result
      );
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
});

const isEntryPoint =
  !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(
      `IPED MCP available at http://127.0.0.1:${port}\n`
    );
  });
}
