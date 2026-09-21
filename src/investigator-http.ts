import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AuditLog } from "./audit-log.js";
import { getConfig } from "./config.js";
import { IpedClient } from "./iped-client.js";
import { InvestigatorService } from "./investigator-service.js";
import { InvestigationSessions } from "./investigation-sessions.js";

const config = getConfig();
const audit = new AuditLog(config.auditLog);
const iped = new IpedClient(config);
const investigations = new InvestigationSessions();
const investigator = new InvestigatorService(iped, investigations, audit);
const port = Number(process.env.INVESTIGATOR_PORT ?? 3333);

const investigatorHtml = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>IPED Investigator</title>
  <style>
    :root{font-family:Inter,system-ui,-apple-system,sans-serif;color:#17202a;background:#f4f6f8}
    *{box-sizing:border-box} body{margin:0} button,input{font:inherit}
    header{background:#17202a;color:white;padding:18px 28px;display:flex;justify-content:space-between;align-items:center}
    header strong{font-size:18px} #connection{font-size:13px;color:#cbd5e1}
    main{max-width:1180px;margin:auto;padding:32px 24px}
    .hero,.panel{background:white;border:1px solid #dfe4ea;border-radius:12px;padding:24px}
    .hero h1{margin:0 0 8px;font-size:26px}.hero p{margin:0;color:#5d6773}
    form{display:flex;gap:10px;margin-top:22px} input{flex:1;padding:13px 15px;border:1px solid #b8c1cc;border-radius:8px}
    button{border:0;border-radius:8px;padding:12px 18px;background:#263b50;color:white;cursor:pointer}
    button:disabled{opacity:.5;cursor:not-allowed}.status{margin-top:14px;font-size:14px}
    .summary{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:20px 0}
    .metric{background:white;border:1px solid #dfe4ea;border-radius:10px;padding:16px}.metric b{display:block;font-size:22px}.metric span{font-size:12px;color:#68727e}
    .grid{display:grid;grid-template-columns:1.4fr 1fr;gap:18px}.panel h2{margin-top:0;font-size:17px}
    .item{border-top:1px solid #edf0f3;padding:12px 0}.item:first-of-type{border-top:0}
    .meta{font-size:12px;color:#68727e}.lead{display:flex;justify-content:space-between;gap:12px;align-items:center}
    .empty{color:#7a8490;font-size:14px}.hidden{display:none}
    @media(max-width:800px){.summary{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}form{flex-direction:column}}
  </style>
</head>
<body>
<header><strong>IPED Investigator</strong><span id="connection">Conectando ao IPED...</span></header>
<main>
  <section class="hero">
    <h1>O que você quer investigar neste caso?</h1>
    <p>Descreva o fato, pessoa, organização, comunicação ou relação que deseja analisar.</p>
    <form id="questionForm">
      <input id="question" autocomplete="off" placeholder="Ex.: investigue relações e comunicações envolvendo Carlos Almeida">
      <button id="startButton">Investigar</button>
    </form>
    <div class="status" id="status"></div>
  </section>
  <section id="workspace" class="hidden">
    <form id="followUpForm">
      <input id="followUp" autocomplete="off" placeholder="Pergunte algo sobre esta investigação">
      <button>Continuar investigação</button>
    </form>
    <div class="summary" id="summary"></div>
    <div class="grid">
      <div class="panel"><h2>Evidências</h2><div id="evidence"></div></div>
      <div class="panel"><h2>Pistas para aprofundar</h2><div id="leads"></div></div>
      <div class="panel"><h2>Relações</h2><div id="relationships"></div></div>
      <div class="panel"><h2>Linha do tempo</h2><div id="timeline"></div></div>
    </div>
  </section>
</main>
<script>
let activeInvestigationId;
const byId=id=>document.getElementById(id);
const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
function items(target,values,render){
  byId(target).innerHTML=values?.length?values.map(render).join(""):'<div class="empty">Nenhum item para exibir.</div>';
}
function renderWorkspace(workspace){
  activeInvestigationId=workspace.investigationId;
  byId("workspace").classList.remove("hidden");
  const s=workspace.summary||{};
  const metrics=[["Evidências",s.evidenceCount],["Entidades",s.entityCount],["Relações",s.relationshipCount],["Comunicações",s.communicationParticipantCount],["Pistas abertas",s.openLeadCount]];
  byId("summary").innerHTML=metrics.map(([label,value])=>'<div class="metric"><b>'+escapeHtml(value??0)+'</b><span>'+label+'</span></div>').join("");
  items("evidence",workspace.panels?.evidence,e=>'<div class="item"><b>'+escapeHtml(e.name||"Evidência")+'</b><div class="meta">'+escapeHtml(e.path||"")+' · item '+escapeHtml(e.itemId)+'</div></div>');
  items("leads",workspace.panels?.leads,l=>'<div class="item lead"><div><b>'+escapeHtml(l.value)+'</b><div class="meta">'+escapeHtml(l.type)+'</div></div>'+(l.status==="OPEN"?'<button type="button" class="leadButton" data-type="'+escapeHtml(l.type)+'" data-value="'+escapeHtml(l.value)+'">Explorar</button>':'<span class="meta">'+escapeHtml(l.status)+'</span>')+'</div>');
  document.querySelectorAll(".leadButton").forEach(button=>button.addEventListener("click",()=>exploreLead(button.dataset.type,button.dataset.value)));
  const rel=workspace.panels?.relationships;
  byId("relationships").innerHTML=rel?'<div class="meta">'+escapeHtml(rel.summary?.nodeCount??0)+' nós · '+escapeHtml(rel.summary?.edgeCount??0)+' relações observadas</div>':'<div class="empty">Nenhuma relação para exibir.</div>';
  items("timeline",workspace.panels?.timeline,t=>'<div class="item"><b>'+escapeHtml(t.label||t.name||"Evento")+'</b><div class="meta">'+escapeHtml(t.timestamp||t.date||"")+'</div></div>');
  byId("status").textContent=workspace.status?.message||"Investigação atualizada.";
}
async function loadHome(){
  try{
    const response=await fetch("/api/home");
    const home=await response.json();
    const ready=home.status==="READY";
    byId("connection").textContent=ready?"IPED conectado":"IPED não disponível";
    byId("startButton").disabled=!ready;
    if(!ready) byId("status").textContent="Abra o IPED com o caso processado e mantenha a Web API disponível.";
  }catch{byId("connection").textContent="IPED não disponível";byId("startButton").disabled=true}
}
async function updateInvestigation(path,payload){
  if(!activeInvestigationId)return;
  byId("status").textContent="Analisando evidências...";
  try{
    const response=await fetch("/api/investigations/"+encodeURIComponent(activeInvestigationId)+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
    const result=await response.json();
    if(result.workspace)renderWorkspace(result.workspace);
    else byId("status").textContent=result.error||result.reason||"A investigação não pôde avançar.";
  }catch{byId("status").textContent="Não foi possível continuar a investigação."}
}
async function exploreLead(leadType,leadValue){
  await updateInvestigation("/leads",{leadType,leadValue});
}
byId("followUpForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const question=byId("followUp").value.trim();if(!question)return;
  byId("followUp").value="";
  await updateInvestigation("/questions",{question});
});
byId("questionForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const question=byId("question").value.trim(); if(!question)return;
  byId("startButton").disabled=true;byId("status").textContent="Investigando evidências...";
  try{
    const response=await fetch("/api/investigations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({question})});
    const result=await response.json();
    if(result.workspace) renderWorkspace(result.workspace);
    else if(result.sourceSelection) byId("status").textContent="Selecione uma fonte do caso para continuar.";
    else byId("status").textContent=result.error||"Não foi possível iniciar a investigação.";
  }catch{byId("status").textContent="Não foi possível iniciar a investigação."}
  finally{byId("startButton").disabled=false}
});
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

      return json(
        response,
        200,
        await investigator.exploreLead(
          decodeURIComponent(leadMatch[1]),
          leadType,
          leadValue
        )
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

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `IPED Investigator available at http://127.0.0.1:${port}\n`
  );
});
