import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

type Answers={ipedHome:string;casePath:string;id?:string};

async function readable(path:string,label:string){try{await access(resolve(path),constants.R_OK);}catch{throw new Error(`${label} não encontrado ou sem permissão de leitura: ${path}`);}}

async function ask():Promise<Answers>{
 const rl=createInterface({input,output});
 try{
  console.log("\nIPED Investigator — conexão simples\n");
  console.log("Use o caso que já foi processado pelo seu IPED. Nada será importado ou alterado.\n");
  const ipedHome=(await rl.question("Pasta da instalação/release do IPED: ")).trim();
  const casePath=(await rl.question("Pasta do caso processado: ")).trim();
  const id=(await rl.question("Nome do caso (Enter para usar o nome da pasta): ")).trim()||undefined;
  if(!ipedHome||!casePath)throw new Error("As pastas do IPED e do caso são obrigatórias.");
  return {ipedHome,casePath,id};
 }finally{rl.close();}
}

async function main(){
 const answers=await ask(); await readable(answers.ipedHome,"IPED"); await readable(answers.casePath,"Caso processado");
 const npm=process.platform==="win32"?"npm.cmd":"npm";
 console.log("\nConectando ao IPED...");
 const connectorArgs=["run","connect:iped","--","--iped-home",resolve(answers.ipedHome),"--case",resolve(answers.casePath)];
 if(answers.id)connectorArgs.push("--id",answers.id);
 const connector=spawn(npm,connectorArgs,{stdio:"inherit",env:process.env});
 connector.on("error",error=>{console.error("Não foi possível iniciar a conexão com o IPED:",error.message);process.exitCode=1;});
 await new Promise(done=>setTimeout(done,1800));
 if(connector.exitCode!==null)throw new Error("A conexão com o IPED terminou antes de ficar disponível.");
 console.log("Iniciando o Investigator...");
 const investigator=spawn(npm,["run","investigator"],{stdio:"inherit",env:process.env});
 const stop=()=>{if(connector.exitCode===null)connector.kill();if(investigator.exitCode===null)investigator.kill();};
 process.on("SIGINT",()=>{stop();process.exit(0);});process.on("SIGTERM",()=>{stop();process.exit(0);});
 investigator.on("exit",code=>{if(connector.exitCode===null)connector.kill();process.exitCode=code??0;});
}
main().catch(error=>{console.error("\n"+(error instanceof Error?error.message:String(error)));process.exit(1);});
