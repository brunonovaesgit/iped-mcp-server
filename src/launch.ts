import { access, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

type Answers={ipedHome:string;casePath:string;id?:string};
async function readable(path:string,label:string){try{await access(resolve(path),constants.R_OK);}catch{throw new Error(`${label} não encontrado ou sem permissão de leitura: ${path}`);}}
async function looksLikeIped(path:string){try{await access(join(path,"lib"),constants.R_OK);return true;}catch{return false;}}
async function directories(root:string){try{return (await readdir(root,{withFileTypes:true})).filter(x=>x.isDirectory()).map(x=>join(root,x.name));}catch{return [];}}
async function findIpedCandidates(){
 const roots=[join(process.cwd(),".."),join(process.cwd(),"../IPED"),join(process.env.HOME||"","Documents"),join(process.env.HOME||"","Downloads")];
 const found:string[]=[];
 for(const root of roots){if(await looksLikeIped(root))found.push(resolve(root));for(const child of await directories(root)){if(await looksLikeIped(child))found.push(resolve(child));for(const nested of await directories(child)){if(await looksLikeIped(nested))found.push(resolve(nested));}}
 return [...new Set(found)].slice(0,8);
}
async function choose(rl:ReturnType<typeof createInterface>,label:string,candidates:string[]){
 if(candidates.length){console.log(`\n${label} encontrado(s):`);candidates.forEach((v,i)=>console.log(`  ${i+1}) ${v}`));const answer=(await rl.question("Escolha um número ou informe outro caminho: ")).trim();const n=Number(answer);if(Number.isInteger(n)&&n>=1&&n<=candidates.length)return candidates[n-1];if(answer)return answer;}
 return (await rl.question(`${label}: `)).trim();
}
async function caseCandidates(ipedHome:string){
 const roots=[join(process.cwd(),"../mcp-lab"),join(process.cwd(),".."),join(ipedHome,"..")],found:string[]=[];
 for(const root of roots){for(const d of await directories(root)){const name=basename(d).toLowerCase();if(name==="resultado"||name==="output"||name.includes("case")||name.includes("caso"))found.push(resolve(d));for(const n of await directories(d)){const nn=basename(n).toLowerCase();if(nn==="resultado"||nn==="output")found.push(resolve(n));}}
 return [...new Set(found)].slice(0,10);
}
async function ask():Promise<Answers>{
 const rl=createInterface({input,output});
 try{
  console.log("\nIPED Investigator — início guiado\n");
  console.log("Seu caso permanece no IPED. Nenhuma evidência será importada, copiada ou alterada.");
  const ipedHome=(await choose(rl,"Instalação do IPED",await findIpedCandidates())).trim();
  if(!ipedHome)throw new Error("A instalação do IPED é obrigatória."); if(!await looksLikeIped(resolve(ipedHome)))throw new Error("A pasta escolhida não parece ser uma release do IPED (diretório lib não encontrado).");
  const casePath=(await choose(rl,"Caso IPED já processado",await caseCandidates(resolve(ipedHome)))).trim();
  if(!casePath)throw new Error("O caso processado é obrigatório."); await readable(casePath,"Caso processado");
  const id=(await rl.question(`Nome do caso [${basename(resolve(casePath))}]: `)).trim()||undefined;
  return {ipedHome,casePath,id};
 }finally{rl.close();}
}
async function main(){
 const answers=await ask();const npm=process.platform==="win32"?"npm.cmd":"npm";
 console.log("\n✓ IPED validado\n✓ Caso localizado\nIniciando conexão...");
 const args=["run","connect:iped","--","--iped-home",resolve(answers.ipedHome),"--case",resolve(answers.casePath)];if(answers.id)args.push("--id",answers.id);
 const connector=spawn(npm,args,{stdio:"inherit",env:process.env});connector.on("error",e=>{console.error("Falha ao iniciar conexão:",e.message);process.exitCode=1;});
 await new Promise(done=>setTimeout(done,1800));if(connector.exitCode!==null)throw new Error("A conexão com o IPED terminou antes de ficar disponível.");
 console.log("\n✓ IPED conectado\n✓ Iniciando Investigator em http://127.0.0.1:3333\n");
 const investigator=spawn(npm,["run","investigator"],{stdio:"inherit",env:process.env});
 const stop=()=>{if(connector.exitCode===null)connector.kill();if(investigator.exitCode===null)investigator.kill();};process.on("SIGINT",()=>{stop();process.exit(0);});process.on("SIGTERM",()=>{stop();process.exit(0);});investigator.on("exit",code=>{if(connector.exitCode===null)connector.kill();process.exitCode=code??0;});
}
main().catch(error=>{console.error("\n"+(error instanceof Error?error.message:String(error)));process.exit(1);});
