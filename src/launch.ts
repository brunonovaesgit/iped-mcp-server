import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, join, resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createServer } from "node:net";
import { entryPoint, processedCaseRoot, stopChild } from "./launcher-runtime.js";

const execFileAsync=promisify(execFile);
type Answers={ipedHome:string;casePath:string;id?:string};
class UserCancelled extends Error{}
async function freeLocalPort(){
 return await new Promise<number>((resolvePort,reject)=>{
  const server=createServer();
  server.unref();
  server.once("error",reject);
  server.listen(0,"127.0.0.1",()=>{
   const address=server.address();
   if(!address||typeof address==="string"){server.close();reject(new Error("Não foi possível reservar uma porta local."));return;}
   const port=address.port;
   server.close(error=>error?reject(error):resolvePort(port));
  });
 });
}
async function nativeFolder(prompt:string){
 if(process.platform!=="darwin")return undefined;
 const script=`POSIX path of (choose folder with prompt "${prompt.replaceAll('"','\\\"')}")`;
 try{const {stdout}=await execFileAsync("/usr/bin/osascript",["-e",script]);return stdout.trim().replace(/\/$/,"");}catch{throw new UserCancelled("Seleção cancelada.");}
}
async function nativeAlert(title:string,message:string){
 if(process.platform!=="darwin")return;
 const esc=(v:string)=>v.replaceAll("\\","\\\\").replaceAll('"','\\\"').replaceAll("\n","\\n");
 try{await execFileAsync("/usr/bin/osascript",["-e",`display alert "${esc(title)}" message "${esc(message)}" as informational buttons {"OK"} default button "OK"`]);}catch{}
}
async function nativeError(message:string){
 if(process.platform!=="darwin")return;
 const escaped=message.replaceAll("\\","\\\\").replaceAll('"','\\\"').replaceAll("\n","\\n");
 try{await execFileAsync("/usr/bin/osascript",["-e",`display alert "IPED MCP" message "${escaped}" as critical buttons {"OK"} default button "OK"`]);}catch{}
}
async function readable(path:string,label:string){try{await access(resolve(path),constants.R_OK);}catch{throw new Error(`${label} não encontrado ou sem permissão de leitura: ${path}`);}}
async function looksLikeIped(path:string){try{await access(join(path,"lib"),constants.R_OK);await access(join(path,"lib","iped-webapi.jar"),constants.R_OK);return true;}catch{return false;}}
async function looksLikeProcessedCase(path:string){return Boolean(await processedCaseRoot(path));}
async function directories(root:string){try{return (await readdir(root,{withFileTypes:true})).filter(x=>x.isDirectory()).map(x=>join(root,x.name));}catch{return [];}}
async function findIpedCandidates(){
 const roots=[join(process.cwd(),".."),join(process.cwd(),"../IPED"),join(process.env.HOME||"","Documents"),join(process.env.HOME||"","Downloads")];
 const found:string[]=[];
 for(const root of roots){
  if(await looksLikeIped(root))found.push(resolve(root));
  for(const child of await directories(root)){
   if(await looksLikeIped(child))found.push(resolve(child));
   for(const nested of await directories(child)){if(await looksLikeIped(nested))found.push(resolve(nested));}
  }
 }
 return [...new Set(found)].slice(0,8);
}
async function choose(rl:ReturnType<typeof createInterface>,label:string,candidates:string[]){
 if(candidates.length){console.log(`\n${label} encontrado(s):`);candidates.forEach((v,i)=>console.log(`  ${i+1}) ${v}`));const answer=(await rl.question("Escolha um número ou informe outro caminho: ")).trim();const n=Number(answer);if(Number.isInteger(n)&&n>=1&&n<=candidates.length)return candidates[n-1];if(answer)return answer;}
 return (await rl.question(`${label}: `)).trim();
}
async function caseCandidates(ipedHome:string){
 const roots=[join(process.cwd(),"../mcp-lab"),join(process.cwd(),".."),join(ipedHome,"..")],found:string[]=[];
 for(const root of roots){
  for(const d of await directories(root)){
   const name=basename(d).toLowerCase();if(name==="resultado"||name==="output"||name.includes("case")||name.includes("caso"))found.push(resolve(d));
   for(const n of await directories(d)){const nn=basename(n).toLowerCase();if(nn==="resultado"||nn==="output")found.push(resolve(n));}
  }
 }
 return [...new Set(found)].slice(0,10);
}
async function ask():Promise<Answers>{
 const args=process.argv.slice(2);
 if(args.length){
  const ipedIndex=args.indexOf("--iped-home"), caseIndex=args.indexOf("--case");
  if(ipedIndex<0||caseIndex<0||!args[ipedIndex+1]||!args[caseIndex+1])throw new Error("Informe --iped-home e --case.");
  const ipedHome=resolve(args[ipedIndex+1]),casePath=resolve(args[caseIndex+1]);
  if(!await looksLikeIped(ipedHome))throw new Error("Selecione a instalação do IPED que contém lib/iped-webapi.jar.");
  if(!await looksLikeProcessedCase(casePath))throw new Error("Selecione um caso processado que contém iped/index e iped/data, ou a própria pasta iped.");
  return {ipedHome,casePath};
 }
 const rl=createInterface({input,output});
 try{
  console.log("\nIPED MCP — início guiado\n");
  console.log("Seu caso permanece no IPED. Nenhuma evidência será importada, copiada ou alterada.");
  const detectedIped=process.platform==="darwin"?[]:await findIpedCandidates();
  const ipedHome=process.platform==="darwin"
   ? (await nativeFolder("Selecione a pasta principal da instalação do IPED"))!
   : (await choose(rl,"Instalação do IPED",detectedIped)).trim();
  if(!ipedHome)throw new Error("A instalação do IPED é obrigatória."); if(!await looksLikeIped(resolve(ipedHome)))throw new Error("A pasta escolhida não parece ser uma release do IPED (diretório lib não encontrado).");
  console.log(`✓ Instalação válida do IPED: ${basename(resolve(ipedHome))}`);
  const detectedCases=process.platform==="darwin"?[]:await caseCandidates(resolve(ipedHome));
  const casePath=process.platform==="darwin"
   ? (await nativeFolder("Selecione a pasta do caso já processado pelo IPED"))!
   : (await choose(rl,"Caso IPED já processado",detectedCases)).trim();
  if(!casePath)throw new Error("O caso processado é obrigatório."); await readable(casePath,"Caso processado");
  if(!await looksLikeProcessedCase(resolve(casePath)))throw new Error("A pasta escolhida não parece ser um caso processado pelo IPED. Selecione a pasta de resultado que contém iped/index e iped/data.");
  console.log(`✓ Caso IPED reconhecido: ${basename(resolve(casePath))}`);
  const id=process.platform==="darwin"?undefined:(await rl.question(`Nome do caso [${basename(resolve(casePath))}]: `)).trim()||undefined;
  return {ipedHome,casePath,id};
 }finally{rl.close();}
}
async function waitForSource(expected:string,connector:ReturnType<typeof spawn>,diagnostics:()=>string,port:number){
 const deadline=Date.now()+60000;let last="";
 while(Date.now()<deadline){
  if(connector.exitCode!==null||connector.signalCode!==null||!connector.pid){const detail=diagnostics().trim();throw new Error("O IPED não conseguiu abrir o caso selecionado."+ (detail ? "\n\nDetalhes técnicos:\n"+detail.slice(-3500) : ""));}
  try{const response=await fetch(`http://127.0.0.1:${port}/sources`,{signal:AbortSignal.timeout(1500)});if(response.ok){last=await response.text();const parsed=JSON.parse(last);const sources=Array.isArray(parsed)?parsed:(Array.isArray(parsed?.data)?parsed.data:[]);const ids=sources.map((x:any)=>typeof x==="string"?x:x?.id).filter(Boolean);if(ids.includes(expected))return ids;}}catch{}
  await new Promise(done=>setTimeout(done,400));
 }
 throw new Error(`O IPED não confirmou o caso selecionado em 60 segundos${last?`. Resposta recebida: ${last.slice(0,160)}`:"."}`);
}
async function waitForInvestigator(child:ReturnType<typeof spawn>,port:number){
 const url=`http://127.0.0.1:${port}`;const deadline=Date.now()+60000;
 while(Date.now()<deadline){
  if(child.exitCode!==null||child.signalCode!==null||!child.pid)throw new Error("O Investigator terminou antes de ficar disponível.");
  try{const response=await fetch(url,{signal:AbortSignal.timeout(1500)});if(response.ok)return url;}catch{}
  await new Promise(done=>setTimeout(done,300));
 }
 throw new Error("O Investigator não ficou disponível em 60 segundos.");
}
async function openBrowser(url:string){
 if(process.platform==="darwin"){await execFileAsync("/usr/bin/open",[url]);return;}
 if(process.platform==="win32"){spawn("cmd",["/c","start","",url],{detached:true,stdio:"ignore"}).unref();return;}
 spawn("xdg-open",[url],{detached:true,stdio:"ignore"}).unref();
}
const desktop=process.argv.includes("--desktop");
let connector:ReturnType<typeof spawn>|undefined;
let investigator:ReturnType<typeof spawn>|undefined;
let stopping=false;
async function shutdown(code:number){
 if(stopping)return;
 stopping=true;
 await Promise.all([stopChild(investigator),stopChild(connector)]);
 process.exit(code);
}
process.on("SIGINT",()=>void shutdown(0));
process.on("SIGTERM",()=>void shutdown(0));
async function main(){
 const answers=await ask();const node=process.execPath;const sourceId=answers.id||basename(resolve(answers.casePath))||"iped-case";
 console.log("\n✓ IPED validado\n✓ Caso localizado\nIniciando conexão...");
 let connectorLog="";let ipedPort=0;
 for(let attempt=1;attempt<=3;attempt++){
  ipedPort=await freeLocalPort();connectorLog="";
  console.log(`Tentativa ${attempt}: IPED Web API em 127.0.0.1:${ipedPort}`);
  const args=[entryPoint("connect-iped.js"),"--iped-home",resolve(answers.ipedHome),"--case",resolve(answers.casePath),"--host","127.0.0.1","--port",String(ipedPort)];if(answers.id)args.push("--id",answers.id);
  connector=spawn(node,args,{stdio:["ignore","pipe","pipe"],env:process.env});
  const append=(chunk:Buffer|string)=>{connectorLog=(connectorLog+chunk.toString()).slice(-12000);};
  connector.stdout?.on("data",chunk=>{append(chunk);process.stdout.write(chunk);});
  connector.stderr?.on("data",chunk=>{append(chunk);process.stderr.write(chunk);});
  connector.on("error",e=>{append("Falha ao iniciar conexão: "+e.message);console.error("Falha ao iniciar conexão:",e.message);});
  console.log("Validando o caso diretamente com o IPED...");
  try{await waitForSource(sourceId,connector,()=>connectorLog,ipedPort);break;}
  catch(error){
   const bindConflict=connectorLog.includes("Address already in use")||connectorLog.includes("BindException");
   if(bindConflict&&attempt<3){await stopChild(connector);console.warn("Porta ocupada durante a inicialização; tentando outra automaticamente.");continue;}
   throw error;
  }
 }
 if(!connector)throw new Error("Não foi possível iniciar a conexão com o IPED.");
 if(!desktop)await nativeAlert("Caso IPED validado",`O IPED confirmou o caso "${sourceId}". O Investigator será iniciado agora.`);
 const investigatorPort=await freeLocalPort();
 console.log(`\n✓ Caso IPED validado: ${sourceId}\n✓ IPED conectado\n✓ Iniciando Investigator em http://127.0.0.1:${investigatorPort}\n`);
 const investigatorEnv={...process.env,IPED_URL:`http://127.0.0.1:${ipedPort}`,INVESTIGATOR_PORT:String(investigatorPort)};
 investigator=spawn(node,[entryPoint("investigator-http.js")],{stdio:"inherit",env:investigatorEnv});
 investigator.on("error",error=>console.error("Falha ao iniciar interface:",error.message));
 investigator.on("exit",code=>{if(!stopping)void shutdown(code??1);});
 connector.on("exit",()=>{if(!stopping){console.error("A conexão IPED foi encerrada.");void shutdown(1);}});
 const investigatorUrl=await waitForInvestigator(investigator,investigatorPort);
 if(desktop)console.log("IPED_MCP_READY="+investigatorUrl);else await openBrowser(investigatorUrl);
 console.log(`✓ Investigator aberto no navegador: ${investigatorUrl}`);

}
main().catch(async error=>{
 if(error instanceof UserCancelled){console.log("Seleção cancelada.");await shutdown(0);return;}
 const message=error instanceof Error?error.message:String(error);
 console.error(message);
 if(!desktop)await nativeError(message+"\n\nAbra novamente o IPED MCP para escolher outra pasta.");
 await shutdown(1);
});
