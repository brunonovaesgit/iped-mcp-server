import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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
    form{display:flex;gap:10px;margin-top:22px} input,select{font:inherit;padding:13px 15px;border:1px solid #b8c1cc;border-radius:8px;background:white} input{flex:1}
    .caseBar{display:flex;gap:12px;align-items:center;margin-top:18px;padding:12px 14px;background:#f7f9fb;border-radius:8px}.caseBar label{font-size:13px;color:#5d6773}.caseBar select{padding:8px 10px}
    button{border:0;border-radius:8px;padding:12px 18px;background:#263b50;color:white;cursor:pointer}
    button:disabled{opacity:.5;cursor:not-allowed}.status{margin-top:14px;font-size:14px}
    .analysis{background:white;border:1px solid #dfe4ea;border-radius:12px;padding:22px;margin:20px 0}.analysis h2{margin:0 0 10px;font-size:18px}.analysis p{line-height:1.55}.analysis .observation{border-top:1px solid #edf0f3;padding:10px 0}.analysis .observation:first-of-type{border-top:0}
    .summary{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:20px 0}
    .metric{background:white;border:1px solid #dfe4ea;border-radius:10px;padding:16px}.metric b{display:block;font-size:22px}.metric span{font-size:12px;color:#68727e}
    .grid{display:grid;grid-template-columns:1.4fr 1fr;gap:18px}.panel h2{margin-top:0;font-size:17px}
    .item{border-top:1px solid #edf0f3;padding:12px 0}.item:first-of-type{border-top:0}
    .meta{font-size:12px;color:#68727e}.lead{display:flex;justify-content:space-between;gap:12px;align-items:center}
    .graph{position:relative;min-height:360px;overflow:auto;border:1px solid #edf0f3;border-radius:8px;margin-top:12px}
    .graph svg{display:block;min-width:620px}.graph line{stroke:#aeb8c2;stroke-width:1.4}.graph text{font-size:11px;fill:#26323d}
    .graph .node{cursor:pointer}.graph .node circle{fill:white;stroke:#52677b;stroke-width:2}.graph .node.evidence circle{stroke:#263b50}.graph .node.communication circle{stroke:#68727e}
    .graph .edge{cursor:pointer}.graph .edge:hover{stroke-width:3}.graphDetail{margin-top:10px;padding:10px;background:#f7f9fb;border-radius:7px;font-size:12px}
    .evidenceButton{background:none;color:#263b50;padding:0;text-align:left;font-weight:700}.evidenceButton:hover{text-decoration:underline}
    .drawer{position:fixed;top:0;right:0;width:min(620px,92vw);height:100vh;background:white;border-left:1px solid #dfe4ea;box-shadow:-8px 0 30px #0002;padding:24px;overflow:auto;z-index:20}
    .drawerHeader{display:flex;justify-content:space-between;gap:16px;align-items:start}.drawerHeader button{padding:7px 11px}.evidenceText{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;line-height:1.5;background:#f7f9fb;padding:14px;border-radius:8px;max-height:46vh;overflow:auto}.property{padding:7px 0;border-top:1px solid #edf0f3}
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
    <div id="caseBar" class="caseBar hidden"><label for="sourceSelect">Fonte do caso</label><select id="sourceSelect"></select></div>
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
    <div class="analysis" id="analysis"></div>
    <div class="analysis hidden" id="retrievalAmbiguities"></div>
    <div class="analysis hidden" id="valueVariations"></div>\n      <div class="analysis hidden" id="aiAnalysis"></div>
    <div class="summary" id="summary"></div>
    <div class="grid">
      <div class="panel"><h2>Achados observados</h2><div id="findings"></div></div>
      <div class="panel"><h2>Evidências</h2><div id="evidence"></div></div>
      <div class="panel"><h2>Valores e entidades correlacionáveis</h2><div id="leads"></div></div>
      <div class="panel"><h2>Relações</h2><div id="relationships"></div><div id="relationshipDetail"></div></div>
      <div class="panel"><h2>Linha do tempo</h2><div id="timeline"></div></div>
    </div>
  </section>
</main>
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
let selectedSourceId;
const byId=id=>document.getElementById(id);
const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
function items(target,values,render){
  byId(target).innerHTML=values?.length?values.map(render).join(""):'<div class="empty">Nenhum item para exibir.</div>';
}
function renderWorkspace(workspace){
  activeInvestigationId=workspace.investigationId;
  byId("workspace").classList.remove("hidden");
  const ambiguityTarget=byId("retrievalAmbiguities");
  const ambiguities=workspace.panels?.retrievalAmbiguities||[];
  if(ambiguities.length){
    ambiguityTarget.classList.remove("hidden");
    ambiguityTarget.innerHTML='<h2>Ambiguidade nos resultados da busca</h2>'
      +ambiguities.map(group=>'<p>'+escapeHtml(group.description)+'</p>'
        +group.candidates.map(candidate=>'<div class="observation"><strong>'+escapeHtml(candidate.value)+'</strong> · '
          +candidate.evidence.map(ref=>'['+escapeHtml(ref.sourceId)+':'+escapeHtml(ref.itemId)+']').join(' ')+'</div>').join('')).join('');
  }else{
    ambiguityTarget.classList.add("hidden");
    ambiguityTarget.innerHTML="";
  }
  const aiAnalysis=workspace.aiAnalysis;
  const aiTarget=byId("aiAnalysis");
  if(aiAnalysis?.enabled){
    aiTarget.classList.remove("hidden");
    const findings=(aiAnalysis.findings||[]).map(finding=>{
      const refs=(finding.evidence||[]).map(reference=>'<span class="meta">['+escapeHtml(reference)+']</span>').join(" ");
      return '<div class="observation"><strong>'+escapeHtml(finding.kind)+'</strong> · '+escapeHtml(finding.statement)+'<div>'+refs+'</div></div>';
    }).join("");
    const limitations=(aiAnalysis.limitations||[]).map(item=>'<li>'+escapeHtml(item)+'</li>').join("");
    const nextSteps=(aiAnalysis.nextSteps||[]).map(item=>'<li>'+escapeHtml(item)+'</li>').join("");
    aiTarget.innerHTML='<h2>Análise assistida por IA</h2>'
      +(findings?'<h3>Achados</h3>'+findings:(aiAnalysis.text?'<div class="evidenceText">'+escapeHtml(aiAnalysis.text)+'</div>':'<p class="meta">Nenhum achado adicional sustentado pelas evidências foi produzido pela IA.</p>'))
      +(limitations?'<h3>Limitações</h3><ul>'+limitations+'</ul>':'')
      +(nextSteps?'<h3>Próximos passos</h3><ul>'+nextSteps+'</ul>':'')
      +'<p class="meta">Análise derivada · modelo '+escapeHtml(aiAnalysis.model||"configurado")+' · cada achado deve ser validado nas evidências citadas.</p>';
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
  const observations=(analysis.observations||[]).map(item=>'<div class="observation">'+escapeHtml(item.text)+'<div class="meta">'+(item.evidence||[]).map(e=>escapeHtml(e.sourceId)+":"+escapeHtml(e.itemId)).join(" · ")+'</div></div>').join("");
  byId("analysis").innerHTML='<h2>Síntese da investigação</h2><p>'+escapeHtml(analysis.headline||"")+'</p>'+observations+(analysis.communication?'<p>'+escapeHtml(analysis.communication)+'</p>':"")+(analysis.limitation?'<p class="meta">'+escapeHtml(analysis.limitation)+'</p>':"");
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
  items("findings",workspace.panels?.findings,f=>'<div class="item"><b>'+escapeHtml(f.value)+'</b><div class="meta">'+escapeHtml(f.type)+' · observado em '+escapeHtml(f.evidenceCount)+' evidência(s)</div><div class="meta">'+(f.evidence||[]).map(e=>escapeHtml(e.sourceId)+":"+escapeHtml(e.itemId)).join(" · ")+'</div></div>');
    items("evidence",workspace.panels?.evidence,e=>'<div class="item"><button type="button" class="evidenceButton" data-source="'+escapeHtml(e.sourceId)+'" data-item="'+escapeHtml(e.itemId)+'">'+escapeHtml(e.name||"Evidência")+'</button><div class="meta">'+escapeHtml(e.path||"")+' · item '+escapeHtml(e.itemId)+'</div></div>');
  document.querySelectorAll(".evidenceButton").forEach(button=>button.addEventListener("click",()=>openEvidence(button.dataset.source,button.dataset.item)));
  items("leads",workspace.panels?.leads,l=>'<div class="item lead"><div><b>'+escapeHtml(l.value)+'</b><div class="meta">'+escapeHtml(l.type)+'</div></div>'+(l.status==="OPEN"?'<button type="button" class="leadButton" data-type="'+escapeHtml(l.type)+'" data-value="'+escapeHtml(l.value)+'">Explorar</button>':'<span class="meta">'+escapeHtml(l.status)+'</span>')+'</div>');
  document.querySelectorAll(".leadButton").forEach(button=>button.addEventListener("click",()=>exploreLead(button.dataset.type,button.dataset.value)));
  renderGraph(workspace.panels?.relationships);
  items("timeline",workspace.panels?.timeline,t=>'<div class="item"><b>'+escapeHtml(t.label||t.name||"Evento")+'</b><div class="meta">'+escapeHtml(t.event||"data")+' · '+escapeHtml(t.timestamp||t.date||"")+'</div></div>');
  byId("status").textContent=workspace.status?.message||"Investigação atualizada.";
}
function renderGraph(graph){
  const target=byId("relationships"),detail=byId("relationshipDetail");
  detail.innerHTML="";
  if(!graph?.nodes?.length){target.innerHTML='<div class="empty">Nenhuma relação para exibir.</div>';return}
  const width=620,height=Math.max(360,Math.ceil(graph.nodes.length/8)*130);
  const centerX=width/2,centerY=height/2,radius=Math.min(width,height)*.36;
  const positions=new Map();
  graph.nodes.forEach((node,index)=>{
    const angle=(Math.PI*2*index)/graph.nodes.length-Math.PI/2;
    positions.set(node.id,{x:centerX+Math.cos(angle)*radius,y:centerY+Math.sin(angle)*radius});
  });
  const edges=(graph.edges||[]).map(edge=>{
    const a=positions.get(edge.from),b=positions.get(edge.to);if(!a||!b)return"";
    return '<line class="edge" data-edge="'+escapeHtml(edge.id)+'" x1="'+a.x+'" y1="'+a.y+'" x2="'+b.x+'" y2="'+b.y+'"></line>';
  }).join("");
  const nodes=graph.nodes.map(node=>{
    const p=positions.get(node.id),kind=node.kind==="EVIDENCE"?"evidence":node.kind==="COMMUNICATION_PARTICIPANT"?"communication":"entity";
    const label=String(node.label||"").slice(0,24);
    return '<g class="node '+kind+'" data-node="'+escapeHtml(node.id)+'" transform="translate('+p.x+' '+p.y+')"><circle r="15"></circle><text x="20" y="4">'+escapeHtml(label)+'</text></g>';
  }).join("");
  const nodeCount=graph.summary && graph.summary.nodeCount !== undefined
    ? graph.summary.nodeCount
    : graph.nodes.length;
  const edgeCount=graph.summary && graph.summary.edgeCount !== undefined
    ? graph.summary.edgeCount
    : (graph.edges ? graph.edges.length : 0);
  target.innerHTML='<div class="meta">'+escapeHtml(nodeCount)+' nós · '+escapeHtml(edgeCount)+' relações observadas</div><div class="graph"><svg width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'">'+edges+nodes+'</svg></div>';
  target.querySelectorAll(".node").forEach(el=>el.addEventListener("click",()=>{
    const node=graph.nodes.find(n=>n.id===el.dataset.node);if(!node)return;
    const supporting=(graph.edges||[]).filter(e=>e.from===node.id||e.to===node.id).flatMap(e=>e.evidence||[]);
    const unique=[...new Map(supporting.map(e=>[e.sourceId+":"+e.itemId,e])).values()];
    detail.innerHTML='<div class="graphDetail"><b>'+escapeHtml(node.label)+'</b><div class="meta">'+escapeHtml(node.kind)+(node.entityType?" · "+escapeHtml(node.entityType):"")+'</div><div>'+unique.length+' evidência(s) de suporte</div></div>';
  }));
  target.querySelectorAll(".edge").forEach(el=>el.addEventListener("click",()=>{
    const edge=(graph.edges||[]).find(e=>e.id===el.dataset.edge);if(!edge)return;
    detail.innerHTML='<div class="graphDetail"><b>'+escapeHtml(edge.relationship)+'</b><div>'+escapeHtml(edge.interpretation||"Relação observada nas evidências.")+'</div><div class="meta">'+(edge.evidence||[]).map(e=>escapeHtml(e.sourceId)+":"+escapeHtml(e.itemId)).join(" · ")+'</div></div>';
  }));
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
    byId("startButton").disabled=!ready;
    if(!ready) byId("status").textContent=selectionStatus==="SOURCE_SELECTION_REQUIRED"?"Há mais de uma fonte neste caso. Selecione qual deseja investigar.":"Abra o IPED com o caso processado e mantenha a Web API disponível.";
    else byId("status").textContent="";
  }catch{byId("connection").textContent="IPED não disponível";byId("startButton").disabled=true;byId("status").textContent="Abra o IPED com o caso processado e mantenha a Web API disponível."}
}
byId("sourceSelect").addEventListener("change",loadHome);
async function updateInvestigation(path,payload){
  if(!activeInvestigationId)return;
  const leadButtons=[...document.querySelectorAll(".leadButton")];
  const followUpButton=byId("followUpForm")?.querySelector("button");
  leadButtons.forEach(button=>{button.disabled=true;if(path==="/leads")button.textContent="Analisando...";});
  if(followUpButton)followUpButton.disabled=true;
  byId("status").textContent="Analisando evidências com IA. Isso pode levar alguns segundos...";
  try{
    const response=await fetch("/api/investigations/"+encodeURIComponent(activeInvestigationId)+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
    const result=await response.json();
    if(result.workspace)renderWorkspace(result.workspace);
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
  byId("followUp").value="";
  await updateInvestigation("/questions",{question});
});
byId("questionForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const question=byId("question").value.trim(); if(!question)return;
  byId("startButton").disabled=true;byId("status").textContent="Investigando evidências...";
  try{
    const response=await fetch("/api/investigations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({question,sourceId:selectedSourceId||undefined})});
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

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `IPED Investigator available at http://127.0.0.1:${port}\n`
  );
});
