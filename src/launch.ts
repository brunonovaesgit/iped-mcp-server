import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, join, resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const execFileAsync=promisify(execFile);
type Answers={ipedHome:string;casePath:string;id?:string};
async function nativeFolder(prompt:string){
 if(process.platform!=="darwin")return undefined;
 const script=`POSIX path of (choose folder with prompt "${prompt.replaceAll('"','\\\"')}")`;
 try{const {stdout}=await execFileAsync("osascript",["-e",script]);return stdout.trim().replace(/\/$/,"");}catch{return undefined;}
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
async function looksLikeIped(path:string){try{await access(join(path,"lib"),constants.R_OK);return true;}catch{return false;}}
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
  const ipedHome=(process.platform==="darwin"?(await nativeFolder("Selecione a pasta principal da instalação do IPED")):undefined) ?? (await choose(rl,"Instalação do IPED",detectedIped)).trim();
  if(!ipedHome)throw new Error("A instalação do IPED é obrigatória."); if(!await looksLikeIped(resolve(ipedHome)))throw new Error("A pasta escolhida não parece ser uma release do IPED (diretório lib não encontrado).");
  console.log(`✓ Instalação válida do IPED: ${basename(resolve(ipedHome))}`);
  const detectedCases=await caseCandidates(resolve(ipedHome));
  const casePath=(process.platform==="darwin"?(await nativeFolder("Selecione a pasta do caso já processado pelo IPED")):undefined) ?? (await choose(rl,"Caso IPED já processado",detectedCases)).trim();
  if(!casePath)throw new Error("O caso processado é obrigatório."); await readable(casePath,"Caso processado");
  const entries=await readdir(resolve(casePath)).catch(()=>[]);if(entries.length===0)throw new Error("A pasta selecionada está vazia e não parece conter um caso processado pelo IPED.");
  console.log(`✓ Pasta do caso acessível: ${basename(resolve(casePath))}`);
  const id=(await rl.question(`Nome do caso [${basename(resolve(casePath))}]: `)).trim()||undefined;
  return {ipedHome,casePath,id};
 }finally{rl.close();}
}
async function waitForSource(expected:string,connector:ReturnType<typeof spawn>){
 const deadline=Date.now()+15000;let last="";
 while(Date.now()<deadline){
  if(connector.exitCode!==null)throw new Error("O IPED não conseguiu abrir o caso selecionado.");
  try{const response=await fetch("http://127.0.0.1:8080/sources");if(response.ok){last=await response.text();const parsed=JSON.parse(last);const ids=Array.isArray(parsed)?parsed.map((x:any)=>typeof x==="string"?x:x?.id).filter(Boolean):[];if(ids.includes(expected))return ids;}}catch{}
  await new Promise(done=>setTimeout(done,400));
 }
 throw new Error(`O IPED não confirmou o caso selecionado em 15 segundos${last?`. Resposta recebida: ${last.slice(0,160)}`:"."}`);
}
async function main(){
 const answers=await ask();const npm=process.platform==="win32"?"npm.cmd":"npm";const sourceId=answers.id||basename(resolve(answers.casePath))||"iped-case";
 console.log("\n✓ IPED validado\n✓ Caso localizado\nIniciando conexão...");
 const args=["run","connect:iped","--","--iped-home",resolve(answers.ipedHome),"--case",resolve(answers.casePath)];if(answers.id)args.push("--id",answers.id);
 const connector=spawn(npm,args,{stdio:"inherit",env:process.env});connector.on("error",e=>{console.error("Falha ao iniciar conexão:",e.message);process.exitCode=1;});
 console.log("Validando o caso diretamente com o IPED...");
 await waitForSource(sourceId,connector);
 await nativeAlert("Caso IPED validado",`O IPED confirmou o caso "${sourceId}". O Investigator será iniciado agora.`);
 console.log(`\n✓ Caso IPED validado: ${sourceId}\n✓ IPED conectado\n✓ Iniciando Investigator em http://127.0.0.1:3333\n`);
 const investigator=spawn(npm,["run","investigator"],{stdio:"inherit",env:process.env});
 const stop=()=>{if(connector.exitCode===null)connector.kill();if(investigator.exitCode===null)investigator.kill();};process.on("SIGINT",()=>{stop();process.exit(0);});process.on("SIGTERM",()=>{stop();process.exit(0);});investigator.on("exit",code=>{if(connector.exitCode===null)connector.kill();process.exitCode=code??0;});
}
main().catch(async error=>{const message=error instanceof Error?error.message:String(error);console.error("\n"+message);await nativeError(message+"\n\nSelecione novamente a instalação do IPED e o caso processado.");process.exit(1);});
