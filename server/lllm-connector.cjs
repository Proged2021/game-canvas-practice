'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {Readable,Writable}=require('node:stream');
const CHUNK=180000,MAX_WIRE=64*1024*1024;
const allowed=(method,p)=>{
 if(p.includes('?')||p.includes('#'))return false;
 if(method==='GET')return p==='/api/status'||p==='/api/private/status'||p==='/api/private/files'||/^\/api\/private\/(?:jobs|files)\/[a-f0-9-]{36}$/.test(p);
 return method==='POST'&&(new Set(['/api/action','/api/chat/session','/api/chat','/api/queue/tickets','/api/private/session','/api/private/session/release','/api/private/reference','/api/private/jobs']).has(p)||/^\/api\/queue\/tickets\/[a-f0-9-]{36}\/(?:heartbeat|release|cancel)$/.test(p)||/^\/api\/private\/files\/[a-f0-9-]{36}\/viewed$/.test(p));
};
function openRequest(wire,key,id){
 const wrapped=wire.subarray(0,256),iv=wire.subarray(256,268),cipher=wire.subarray(268);
 const raw=crypto.privateDecrypt({key,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},wrapped);
 if(raw.length!==32)throw Error('Invalid key');
 try{const dec=crypto.createDecipheriv('aes-256-gcm',raw,iv);dec.setAAD(Buffer.from('lllm-v1:req:'+id));dec.setAuthTag(cipher.subarray(-16));const plain=Buffer.concat([dec.update(cipher.subarray(0,-16)),dec.final()]);try{return {key:Buffer.from(raw),packet:JSON.parse(plain.toString('utf8'))};}finally{plain.fill(0);}}finally{raw.fill(0);}
}
function sealResponse(packet,key,id){
 const plain=Buffer.from(JSON.stringify(packet)),iv=crypto.randomBytes(12);
 try{const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('lllm-v1:res:'+id));return Buffer.concat([iv,cipher.update(plain),cipher.final(),cipher.getAuthTag()]);}finally{plain.fill(0);}
}
async function invoke(packet,account,id,ctx,signal){
 if(!allowed(packet.method,packet.path)||typeof packet.body!=='string'||packet.body.length>30*1024*1024)throw Error('Disallowed operation');
 const bytes=Buffer.from(packet.body,'base64');packet.body='';
 const req=Readable.from(bytes.length?[bytes]:[]);
 req.method=packet.method;req.url=packet.path;
 req.headers={host:'localhost',origin:'http://localhost','x-control-token':ctx.getToken()};
 for(const name of ['content-type','x-ai-ticket']){const value=packet.headers?.[name];if(typeof value==='string'&&value.length<256)req.headers[name]=value;}
 req.socket={remoteAddress:'workspace:'+account};ctx.markRequest(req);
 let status=200,headers={},buffers=[],total=0;
 const res=new Writable({write(chunk,_encoding,callback){total+=chunk.length;if(total>30*1024*1024)return callback(Error('Response too large'));buffers.push(Buffer.from(chunk));callback();}});
 res.headersSent=false;
 res.setHeader=(k,v)=>{headers[k.toLowerCase()]=String(v);};
 res.getHeader=k=>headers[k.toLowerCase()];
 res.writeHead=(code,h)=>{status=code;for(const[k,v]of Object.entries(h||{}))res.setHeader(k,v);res.headersSent=true;return res;};
 res.flushHeaders=()=>{res.headersSent=true;};
 const abort=()=>{req.destroy();res.destroy(Error('Cancelled'));};signal.addEventListener('abort',abort,{once:true});
 try{
  const finished=new Promise((resolve,reject)=>{res.once('finish',resolve);res.once('error',reject);});
  const dispatched=Promise.resolve().then(()=>ctx.dispatch(req,res)).catch(e=>{res.destroy(e);throw e;});
  await Promise.all([finished,dispatched]);
  let data=Buffer.concat(buffers);
  try{
   if(packet.path==='/api/status'&&status===200){const s=JSON.parse(data.toString());data.fill(0);data=Buffer.from(JSON.stringify({current:s.current,models:s.models,memory:s.memory,job:s.job,lastJob:s.lastJob,chatBusy:s.chatBusy,queueRunning:s.queueRunning,queuePending:s.queuePending,imageRunning:s.imageRunning,privateImageBusy:s.privateImageBusy,scheduler:s.scheduler,textPrivacy:s.textPrivacy,actionToken:'workspace'}));}
   const safeHeaders={};for(const name of ['content-type','x-chat-encryption'])if(headers[name])safeHeaders[name]=headers[name];
   return {status,headers:safeHeaders,body:data.toString('base64')};
  }finally{data.fill(0);}
 }finally{signal.removeEventListener('abort',abort);bytes.fill(0);for(const b of buffers)b.fill(0);buffers=[];}
}

module.exports=function startWorkspaceRelay(ctx){
 const configPath=path.join(ctx.root,'state','workspace-lllm.dpapi');
 if(!fs.existsSync(configPath))return {close(){}};
 const script="$p=[IO.File]::ReadAllText($env:LLLM_CONFIG_PATH);$s=ConvertTo-SecureString $p;$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}";
 const opened=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,env:{...process.env,LLLM_CONFIG_PATH:configPath},timeout:15000});
 if(opened.status!==0){console.error('Workspace LLLM configuration unavailable');return {close(){}};}
 let cfg;try{cfg=JSON.parse(opened.stdout);}catch{return {close(){}};}opened.stdout='';
 const url=new URL(cfg.origin);if(url.protocol!=='https:'||url.origin!=='https://game-canvas.app')return {close(){}};
 const privateKey=crypto.createPrivateKey(cfg.privateKey);cfg.privateKey='';
 const tasks=new Map();let stopped=false,booted=false;
 async function call(data){const r=await fetch(url.origin+'/api/lllm-connector',{method:'POST',headers:{authorization:'Bearer '+cfg.token,'content-type':'application/json'},body:JSON.stringify(data),cache:'no-store',signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('Relay unavailable');return r.json();}
 async function processJob(job,controller){let wire,key,response;
  try{
   const chunks=[];for(let part=0;part<job.request_parts;part++){if(controller.signal.aborted)throw Error('Cancelled');chunks.push((await call({action:'read',id:job.id,part})).ciphertext);}
   wire=Buffer.from(chunks.join(''),'base64');chunks.length=0;if(wire.length>MAX_WIRE)throw Error('Too large');
   const opened=openRequest(wire,privateKey,job.id);key=opened.key;wire.fill(0);wire=null;
   response=await invoke(opened.packet,job.account_key,job.id,ctx,controller.signal);
   wire=sealResponse(response,key,job.id);response.body='';response=null;
   const encoded=wire.toString('base64');wire.fill(0);wire=null;const parts=Math.ceil(encoded.length/CHUNK);if(parts>360)throw Error('Too large');
   for(let part=0;part<parts;part++){if(controller.signal.aborted)throw Error('Cancelled');await call({action:'write',id:job.id,part,ciphertext:encoded.slice(part*CHUNK,(part+1)*CHUNK)});}
   await call({action:'complete',id:job.id,parts});
  }catch{if(!stopped)await call({action:'fail',id:job.id}).catch(()=>{});}
  finally{wire?.fill(0);key?.fill(0);if(response)response.body='';tasks.delete(job.id);}
 }
 async function loop(){
  while(!stopped){
   try{
    const active=[...tasks.keys()];const state=await call({action:booted?'poll':'boot',active});booted=true;
    for(const id of active)if(!state.active.includes(id))tasks.get(id)?.abort();
    for(const job of state.jobs){if(tasks.has(job.id))continue;const controller=new AbortController();tasks.set(job.id,controller);void processJob(job,controller);}
   }catch{for(const controller of tasks.values())controller.abort();}
   await new Promise(resolve=>{const timer=setTimeout(resolve,tasks.size?700:2500);timer.unref();});
  }
 }
 void loop();return {close(){stopped=true;for(const controller of tasks.values())controller.abort();cfg.token='';}};
};
module.exports.testHelpers={allowed,openRequest,sealResponse,invoke};
