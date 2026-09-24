import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, join, resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createServer } from "node:net";

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
 try{const {stdout}=await execFileAsync("osascript",["-e",script]);return stdout.trim().replace(/\/$/,"");}catch{throw new UserCancelled("Seleção cancelada.");}
}
async function nativeAlert(title:string,message:string){
 if(process.platform!=="darwin")return;
 const esc=(v:string)=>v.replaceAll("\\","\\\\").replaceAll('"','\\\"').replaceAll("\n","\\n");
 try{await execFileAsync("osascript",["-e",`display alert "${esc(title)}" message "${esc(message)}" as informational buttons {"OK"} default button "OK"`]);}catch{}
}
async function nativeError(message:string){
 if(process.platform!=="darwin")return;
 const escaped=message.replaceAll("\\","\\\\").replaceAll('"','\\\"').replaceAll("\n","\\n");
 try{await execFileAsync("osascript",["-e",`display alert "IPED Investigator" message "${escaped}" as critical buttons {"OK"} default button "OK"`]);}catch{}
}
async function readable(path:string,label:string){try{await access(resolve(path),constants.R_OK);}catch{throw new Error(`${label} não encontrado ou sem permissão de leitura: ${path}`);}}
async function looksLikeIped(path:string){try{await access(join(path,"lib"),constants.R_OK);await access(join(path,"lib","iped-webapi.jar"),constants.R_OK);return true;}catch{return false;}}
async function looksLikeProcessedCase(path:string){
 const candidates=[join(path,"iped"),path];
 for(const root of candidates){
  try{await access(join(root,"index"),constants.R_OK);await access(join(root,"data"),constants.R_OK);return true;}catch{}
 }
 return false;
}
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
 const rl=createInterface({input,output});
 try{
  console.log("\nIPED Investigator — início guiado\n");
  console.log("Seu caso permanece no IPED. Nenhuma evidência será importada, copiada ou alterada.");
  const detectedIped=await findIpedCandidates();
  const ipedHome=process.platform==="darwin"
   ? (await nativeFolder("Selecione a pasta principal da instalação do IPED"))!
   : (await choose(rl,"Instalação do IPED",detectedIped)).trim();
  if(!ipedHome)throw new Error("A instalação do IPED é obrigatória."); if(!await looksLikeIped(resolve(ipedHome)))throw new Error("A pasta escolhida não parece ser uma release do IPED (diretório lib não encontrado).");
  console.log(`✓ Instalação válida do IPED: ${basename(resolve(ipedHome))}`);
  const detectedCases=await caseCandidates(resolve(ipedHome));
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
 const deadline=Date.now()+15000;let last="";
 while(Date.now()<deadline){
  if(connector.exitCode!==null){const detail=diagnostics().trim();throw new Error("O IPED não conseguiu abrir o caso selecionado."+ (detail ? "\n\nDetalhes técnicos:\n"+detail.slice(-3500) : ""));}
  try{const response=await fetch(`http://127.0.0.1:${port}/sources`);if(response.ok){last=await response.text();const parsed=JSON.parse(last);const sources=Array.isArray(parsed)?parsed:(Array.isArray(parsed?.data)?parsed.data:[]);const ids=sources.map((x:any)=>typeof x==="string"?x:x?.id).filter(Boolean);if(ids.includes(expected))return ids;}}catch{}
  await new Promise(done=>setTimeout(done,400));
 }
 throw new Error(`O IPED não confirmou o caso selecionado em 15 segundos${last?`. Resposta recebida: ${last.slice(0,160)}`:"."}`);
}
async function waitForInvestigator(child:ReturnType<typeof spawn>){
 const url="http://127.0.0.1:3333";const deadline=Date.now()+15000;
 while(Date.now()<deadline){
  if(child.exitCode!==null)throw new Error("O Investigator terminou antes de ficar disponível.");
  try{const response=await fetch(url);if(response.ok)return url;}catch{}
  await new Promise(done=>setTimeout(done,300));
 }
 throw new Error("O Investigator não ficou disponível em 15 segundos.");
}
async function openBrowser(url:string){
 if(process.platform==="darwin"){await execFileAsync("open",[url]);return;}
 if(process.platform==="win32"){spawn("cmd",["/c","start","",url],{detached:true,stdio:"ignore"}).unref();return;}
 spawn("xdg-open",[url],{detached:true,stdio:"ignore"}).unref();
}
async function main(){
 const answers=await ask();const node=process.execPath;const sourceId=answers.id||basename(resolve(answers.casePath))||"iped-case";
 console.log("\n✓ IPED validado\n✓ Caso localizado\nIniciando conexão...");
 let connector:ReturnType<typeof spawn>|undefined;let connectorLog="";let ipedPort=0;
 for(let attempt=1;attempt<=3;attempt++){
  ipedPort=await freeLocalPort();connectorLog="";
  console.log(`Tentativa ${attempt}: IPED Web API em 127.0.0.1:${ipedPort}`);
  const args=[resolve("dist/connect-iped.js"),"--iped-home",resolve(answers.ipedHome),"--case",resolve(answers.casePath),"--host","127.0.0.1","--port",String(ipedPort)];if(answers.id)args.push("--id",answers.id);
  connector=spawn(node,args,{stdio:["ignore","pipe","pipe"],env:process.env});
  const append=(chunk:Buffer|string)=>{connectorLog=(connectorLog+chunk.toString()).slice(-12000);};
  connector.stdout?.on("data",chunk=>{append(chunk);process.stdout.write(chunk);});
  connector.stderr?.on("data",chunk=>{append(chunk);process.stderr.write(chunk);});
  connector.on("error",e=>{append("Falha ao iniciar conexão: "+e.message);console.error("Falha ao iniciar conexão:",e.message);});
  console.log("Validando o caso diretamente com o IPED...");
  try{await waitForSource(sourceId,connector,()=>connectorLog,ipedPort);break;}
  catch(error){
   const bindConflict=connectorLog.includes("Address already in use")||connectorLog.includes("BindException");
   if(bindConflict&&attempt<3){if(connector.exitCode===null)connector.kill();console.warn("Porta ocupada durante a inicialização; tentando outra automaticamente.");continue;}
   throw error;
  }
 }
 if(!connector)throw new Error("Não foi possível iniciar a conexão com o IPED.");
 await nativeAlert("Caso IPED validado",`O IPED confirmou o caso "${sourceId}". O Investigator será iniciado agora.`);
 console.log(`\n✓ Caso IPED validado: ${sourceId}\n✓ IPED conectado\n✓ Iniciando Investigator em http://127.0.0.1:3333\n`);
 const investigator=spawn(node,[resolve("dist/investigator-http.js")],{stdio:"inherit",env:process.env});
 const investigatorUrl=await waitForInvestigator(investigator);
 await openBrowser(investigatorUrl);
 console.log(`✓ Investigator aberto no navegador: ${investigatorUrl}`);
 const stop=()=>{if(connector&&connector.exitCode===null)connector.kill();if(investigator.exitCode===null)investigator.kill();};process.on("SIGINT",()=>{stop();process.exit(0);});process.on("SIGTERM",()=>{stop();process.exit(0);});investigator.on("exit",code=>{if(connector&&connector.exitCode===null)connector.kill();process.exitCode=code??0;});
}
main().catch(async error=>{if(error instanceof UserCancelled){console.log("\nSeleção cancelada pelo usuário.");process.exit(0);}const message=error instanceof Error?error.message:String(error);console.error("\n"+message);await nativeError(message+"\n\nAbra novamente o IPED Investigator para escolher outra pasta.");process.exit(1);});
