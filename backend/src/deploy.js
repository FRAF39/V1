import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { q } from "./db.js";
import { ensureProjectDir, directorySize } from "./storage.js";
import { config } from "./config.js";

const portBase = 12000;
let nextPort = portBase;
const running = new Map();

function run(cmd,args,opts={}) {
  return new Promise((resolve,reject)=>{
    const p=spawn(cmd,args,{env:process.env,...opts});
    let out="",err="";
    p.stdout?.on("data",d=>out+=d);
    p.stderr?.on("data",d=>err+=d);
    const t=setTimeout(()=>{p.kill("SIGKILL");reject(new Error("Command timeout"));}, config.deploymentTimeoutMs);
    p.on("error",reject);
    p.on("close",c=>{clearTimeout(t); c===0?resolve(out):reject(new Error(err||`exit ${c}`));});
  });
}
async function log(id,line,stream="stdout") { await q("INSERT INTO deployment_logs(deployment_id,stream,line) VALUES($1,$2,$3)",[id,stream,line.slice(0,8000)]); }

export async function deploy({id,userId,projectId,runtime,buildCommand,startCommand}) {
  let port = nextPort++;
  if (nextPort > 19999) nextPort=portBase;
  const name = `priyo-${id}`;
  const work = await ensureProjectDir(userId,projectId);
  const image = `priyo-host-${id}:latest`;
  await q("UPDATE deployments SET status='Building',container_name=$2,host_port=$3,image_name=$4 WHERE id=$1",[id,name,port,image]);
  try {
    if (process.env.NODE_ENV === "production" && !process.env.DOCKER_HOST) throw new Error("No Docker executor configured. Render web services do not provide a Docker daemon; configure DOCKER_HOST to a dedicated isolated Docker executor.");
    const dockerfile = path.join(work,".priyo.Dockerfile");
    let body;
    if (runtime==="html") body = `FROM nginx:1.27-alpine\nCOPY . /usr/share/nginx/html\n`;
    else if (runtime==="node") body = `FROM node:22-alpine\nRUN addgroup -S app && adduser -S app -G app\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev || npm install --omit=dev\nCOPY . .\nRUN chown -R app:app /app\nUSER app\nEXPOSE 3000\n`;
    else body = `FROM python:3.12-alpine\nRUN addgroup -S app && adduser -S app -G app\nWORKDIR /app\nCOPY requirements.txt* ./\nRUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi\nCOPY . .\nRUN chown -R app:app /app\nUSER app\nEXPOSE 3000\n`;
    await fs.writeFile(dockerfile,body);
    await log(id,`Building image ${image}`);
    await run("docker",["build","--network=none","-f",dockerfile,"-t",image,work]);
    const envArgs = [];
    const containerPort = runtime === "html" ? 80 : 3000;
    const cmd = startCommand || (runtime==="html" ? "nginx -g 'daemon off;'" : runtime==="node" ? "npm start" : "python -m flask run --host=0.0.0.0 --port=3000");
    const shellCmd = runtime==="html" ? cmd : cmd.replaceAll("$PORT",String(containerPort));
    const args=["run","-d","--name",name,"--read-only","--tmpfs","/tmp:rw,noexec,nosuid,size=64m","--cpus","0.5","--memory","256m","--pids-limit","128","--network","none","-p",`${port}:${containerPort}`,"--cap-drop","ALL","--security-opt","no-new-privileges",...envArgs,image,"/bin/sh","-lc",shellCmd];
    await run("docker",args);
    running.set(id,name);
    await q("UPDATE deployments SET status='Running',started_at=now(),url=$2 WHERE id=$1",[id,`${config.publicBaseUrl}/d/${id}/`]);
    await log(id,"Container started");
  } catch(e) {
    await q("UPDATE deployments SET status='Failed',error_message=$2 WHERE id=$1",[id,String(e.message).slice(0,2000)]);
    await log(id,e.stack||e.message,"stderr");
  }
}
export async function stopDeployment(id) {
  const r=await q("SELECT container_name FROM deployments WHERE id=$1",[id]);
  const name=r.rows[0]?.container_name;
  if (name) { try { await run("docker",["rm","-f",name]); } catch {} }
  running.delete(id);
  await q("UPDATE deployments SET status='Stopped',stopped_at=now() WHERE id=$1",[id]);
  await log(id,"Deployment stopped");
}
export async function logsFor(id) { return (await q("SELECT stream,line,created_at FROM deployment_logs WHERE deployment_id=$1 ORDER BY id",[id])).rows; }
