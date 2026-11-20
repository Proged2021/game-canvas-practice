const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const workspaceRequests = new WeakSet();
const token = crypto.randomBytes(32).toString('hex');
const peers = new Set(['127.0.0.1', cfg.meshIp, ...cfg.allowedPeers]);
const hosts = new Set(['localhost','127.0.0.1',cfg.meshIp,cfg.meshName]);
const ps = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const models = [
  {id:'gemma', name:'Gemma 4', detail:'26B-A4B · Balanced · 画像入力対応', type:'chat', alias:'gemma4-26b-a4b-balanced', start:'C:/AI/llama.cpp/Start-Gemma.ps1', stop:'C:/AI/llama.cpp/Stop-Gemma.ps1'},
  {id:'qwen', name:'Qwen 3.8', detail:'27B · Huihui · 画像入力対応', type:'chat', alias:'huihui-qwen3.8-27b-abliterated', start:'C:/AI/llama.cpp/Start-Qwen.ps1', stop:'C:/AI/llama.cpp/Stop-Qwen.ps1'},
  {id:'qwen25', name:'Qwen2.5-0.5B-Instruct', detail:'0.5B · 軽量 · テキスト専用 · Q8_0', type:'chat', alias:'qwen2.5-0.5b-instruct', start:'C:/AI/llama.cpp/Start-Qwen25-0.5B.ps1', stop:'C:/AI/llama.cpp/Stop-Qwen25-0.5B.ps1'},
  {id:'noctq', name:'NoctQ V4', detail:'画像生成 · ComfyUI', type:'image', start:'C:/AI/NoctQ/Start-NoctQ.ps1', stop:'C:/AI/NoctQ/Stop-NoctQ.ps1'}
];
let job = null, lastJob = null, cached = null, cachedAt = 0, pendingStatus = null;
let studio;
let privateImages;
let bootTest;
let stabilityTest;
let scheduler;
const queueBypass=req=>normalize(req.socket.remoteAddress)==='127.0.0.1'&&(bootTest?.isActive()||stabilityTest?.admits(req));
function log(message) { console.log(new Date().toISOString()+' '+message); }
function normalize(ip) { return (ip || '').replace(/^::ffff:/,''); }
function admitted(req) {
  const host = (req.headers.host || '').toLowerCase().split(':')[0];
  return workspaceRequests.has(req) || (peers.has(normalize(req.socket.remoteAddress)) && hosts.has(host));
}
function ownOrigin(req) { return !req.headers.origin || req.headers.origin === 'http://' + req.headers.host; }
function json(res, code, data) {
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}
async function getJson(url) {
  try { const r = await fetch(url,{headers:url.startsWith('http://127.0.0.1:8188/')?privateImages?.backendHeaders():undefined,signal:AbortSignal.timeout(1800)}); return r.ok ? await r.json() : null; } catch { return null; }
}
async function inspect() {
  const [health, list, image, queue] = await Promise.all([
    getJson('http://127.0.0.1:8080/health'), getJson('http://127.0.0.1:8080/v1/models'),
    getJson('http://127.0.0.1:8188/system_stats'), getJson('http://127.0.0.1:8188/queue')
  ]);
  const alias = list?.data?.[0]?.id;
  const current = health?.status === 'ok' ? models.find(m=>m.alias === alias)?.id : null;
  return {current, imageRunning:!!image?.system, queueRunning:queue?.queue_running?.length || 0, queuePending:queue?.queue_pending?.length || 0,
    models:models.map(({id,name,detail,type})=>({id,name,detail,type,running:id==='noctq'?!!image?.system:current===id})),
    memory:{freeGiB:Math.round(os.freemem()/1073741824*10)/10,totalGiB:Math.round(os.totalmem()/1073741824)},
    meshIp:cfg.meshIp, meshName:cfg.meshName, dashboardPort:cfg.dashboardPort, chatPort:cfg.chatPort, imagePort:cfg.imagePort};
}
async function status(force=false) {
  if (!force && cached && Date.now()-cachedAt<1500) return cached;
  if (!pendingStatus) pendingStatus=inspect().then(s=>{cached=s;cachedAt=Date.now();return s;}).finally(()=>pendingStatus=null);
  return pendingStatus;
}
function runScript(file, flag) {
  return new Promise((resolve,reject)=>{
    const child=spawn(ps,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file,flag],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';
    child.stdout.on('data',b=>{output=(output+b.toString()).slice(-12000);});
    child.stderr.on('data',b=>{output=(output+b.toString()).slice(-12000);});
    const timer=setTimeout(()=>{child.kill();reject(new Error('起動待ちがタイムアウトしました。PC側の状態を確認してください。'));},420000);
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('exit',code=>{clearTimeout(timer);child.stdout.destroy();child.stderr.destroy();code===0?resolve():reject(new Error(output.trim() || '起動・停止に失敗しました。'));});
  });
}
async function action(verb,id) {
  if (job) return {code:409,error:'別の操作を実行中です。完了までお待ちください。'};
  const model=models.find(m=>m.id===id);
  if (!model || !['start','stop'].includes(verb)) return {code:400,error:'登録されていない操作です。'};
  const before=await status(true);
  if (job) return {code:409,error:'別の操作を実行中です。'};
  const conflict=studio?.actionConflict(verb,id,before);
  if(conflict)return {code:409,error:conflict};
  if(privateImages?.busy()&&((verb==='stop'&&id==='noctq')||(verb==='start'&&id!=='noctq')))return {code:409,error:'保護された画像処理が完了するまでお待ちください。'};
  const active=before.models.find(m=>m.id===id)?.running;
  if ((verb==='start' && active) || (verb==='stop' && !active)) return {code:200,message:active?'すでに起動しています。':'すでに停止しています。'};
  if (verb==='start' && id!=='noctq' && (before.queueRunning || before.queuePending)) return {code:409,error:'画像生成中です。生成が完了してから切り替えてください。'};
  const thisJob={id:crypto.randomUUID(),modelId:id,verb,label:model.name+'を'+(verb==='start'?'起動':'停止')+'中',startedAt:new Date().toISOString()};
  job=thisJob; log('ACTION '+verb+' '+id);
  (async()=>{
    try {
      await runScript(verb==='start'?model.start:model.stop,verb==='start'?'-NoBrowser':'-Quiet');
      const after=await status(true);
      const running=after.models.find(m=>m.id===id)?.running;
      if (verb==='start' && !running) throw new Error('起動完了を確認できませんでした。もう一度状態を確認してください。');
      if (verb==='stop' && running) throw new Error('停止完了を確認できませんでした。');
      lastJob={...thisJob,ok:true,message:model.name+'を'+(verb==='start'?'起動':'停止')+'しました。'};
      log('DONE '+verb+' '+id);
    } catch(e) {
      log('ERROR '+e.message); lastJob={...thisJob,ok:false,message:String(e.message).slice(-2500)};
    } finally {job=null;cachedAt=0;}
  })();
  return {code:202,message:thisJob.label,job:thisJob};
}
async function readBody(req) {
  let data=''; for await (const b of req) {data+=b;if(data.length>4096) throw new Error('リクエストが大きすぎます。');} return JSON.parse(data);
}
async function dashboard(req,res) {
  if (!admitted(req)) return json(res,403,{error:'この端末からの接続は許可されていません。'});
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  const requestedPath=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET'&&requestedPath==='/api/stability-test')return json(res,200,stabilityTest?.publicStatus()||{state:'not-scheduled'});
  if(req.method==='POST'&&stabilityTest?.isActive()&&['/api/action','/api/chat','/api/chat/session','/api/private/jobs','/api/private/reference','/api/tools/adrenalin'].includes(requestedPath)&&!stabilityTest.admits(req))return json(res,423,{error:'20分間のGPU動作確認中です。完了までお待ちください。'});
  if(req.method==='GET'&&requestedPath==='/api/boot-test')return json(res,200,bootTest?.publicStatus()||{state:'not-scheduled'});
  if(req.method==='POST'&&bootTest?.isActive()&&normalize(req.socket.remoteAddress)!=='127.0.0.1'&&['/api/action','/api/chat','/api/private/jobs','/api/private/reference'].includes(requestedPath))return json(res,423,{error:'再起動後の動作確認中です。完了までお待ちください。'});
  if(await scheduler?.handle(req,res))return;
  if(req.method==='POST'&&!queueBypass(req)&&['/api/action','/api/chat/session','/api/chat','/api/private/reference','/api/private/jobs'].includes(requestedPath)){
    if(!ownOrigin(req)||req.headers['x-control-token']!==token)return json(res,403,{error:'ページを再読み込みしてください。'});
    const expected=requestedPath.startsWith('/api/private/')?'noctq':undefined;
    if(!await scheduler.guard(req,res,expected))return;
  }
  if(await privateImages.handle(req,res))return;
  if(await studio.handle(req,res))return;
  const url=new URL(req.url,'http://localhost');
  if (req.method==='GET' && url.pathname==='/') {
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
    return fs.createReadStream(path.join(__dirname,'public/index.html')).pipe(res);
  }
  if (req.method==='GET' && ['/app.js','/style.css'].includes(url.pathname)) {
    res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8','X-Content-Type-Options':'nosniff'});
    return fs.createReadStream(path.join(__dirname,'public',url.pathname.slice(1))).pipe(res);
  }
  if (req.method==='GET' && url.pathname==='/api/status') return json(res,200,{...(await status()),...studio.activity(),privateImageBusy:privateImages.busy(),privacyEnabled:true,scheduler:scheduler?.summary(),stabilityTest:stabilityTest?.publicStatus(),bootTest:bootTest?.publicStatus(),job,lastJob,actionToken:token});
  if(req.method==='POST'&&url.pathname==='/api/tools/adrenalin'){
    if(!ownOrigin(req)||req.headers['x-control-token']!==token)return json(res,403,{error:'ページを再読み込みしてください。'});
    const executable='C:/Program Files/AMD/CNext/CNext/RadeonSoftware.exe';
    if(!fs.existsSync(executable))return json(res,404,{error:'AMD Adrenalinが見つかりません。'});
    const child=spawn(executable,[],{detached:true,stdio:'ignore',windowsHide:false});
    child.once('error',()=>{if(!res.headersSent)json(res,500,{error:'AMD Adrenalinを起動できませんでした。'});});
    child.once('spawn',()=>{child.unref();json(res,200,{message:'このPCのデスクトップでAMD Adrenalinを開きました。'});});return;
  }
  if (req.method==='POST' && url.pathname==='/api/action') {
    if (!ownOrigin(req) || req.headers['x-control-token']!==token || !String(req.headers['content-type']).startsWith('application/json')) return json(res,403,{error:'操作の確認に失敗しました。ページを再読み込みしてください。'});
    try {const b=await readBody(req);if(!queueBypass(req)&&!scheduler.owns(req.headers['x-ai-ticket'],normalize(req.socket.remoteAddress),b.model))return json(res,409,{error:'受付したモデルと操作が一致しません。'});const r=await action(b.action,b.model);return json(res,r.code,r);}
    catch {return json(res,400,{error:'リクエストを読み取れません。'});}
  }
  return json(res,404,{error:'見つかりません。'});
}
const hop=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);
function headersFor(req,upstreamPort) {
  const h={}; for(const [key,val] of Object.entries(req.headers)) if(!hop.has(key)) h[key]=val;
  h.host='127.0.0.1:'+upstreamPort;
  if(h.origin) h.origin='http://127.0.0.1:'+upstreamPort;
  delete h['x-forwarded-for']; delete h.forwarded;
  return h;
}
function makeProxy(port) {
  const server=http.createServer((req,res)=>{
    if(!admitted(req)||!ownOrigin(req)) return json(res,403,{error:'接続が許可されていません。'});
    if(port===8080){
      if(req.method==='GET'&&new URL(req.url,'http://localhost').pathname==='/'){res.writeHead(302,{'Location':'http://'+req.headers.host.split(':')[0]+':'+cfg.dashboardPort+'/#chat','Cache-Control':'no-store'});return res.end();}
      return json(res,403,{error:'暗号化した会話を使うため、AI Studioのテキスト画面を開いてください。'});
    }
    if(port===8188){
      if(req.method==='GET'&&['/','/image-edit','/image-edit/'].includes(new URL(req.url,'http://localhost').pathname)){
        res.writeHead(302,{'Location':'http://'+req.headers.host.split(':')[0]+':'+cfg.dashboardPort+(req.url.startsWith('/image-edit')?'/#edit':'/#generate'),'Cache-Control':'no-store'});return res.end();
      }
      return json(res,403,{error:'画像の保護を有効にしました。AI Studioを利用してください。'});
    }
    if(!req.url.startsWith('/')||req.url.startsWith('//')) return json(res,400,{error:'Invalid path'});
    if(port===8188 && req.method==='GET') {
      const pathname=new URL(req.url,'http://localhost').pathname;
      if(pathname==='/image-edit'||pathname==='/image-edit/'){
        res.writeHead(302,{'Location':'http://'+req.headers.host.split(':')[0]+':'+cfg.dashboardPort+'/#edit','Cache-Control':'no-store'});return res.end();
      }
      const assets={'/image-edit':['image-edit.html','text/html'],'/image-edit/':['image-edit.html','text/html'],'/image-edit.js':['image-edit.js','text/javascript'],'/image-edit.css':['image-edit.css','text/css'],'/image-edit-workflow.json':['image-edit-workflow.json','application/json']};
      if(assets[pathname]) {
        const [file,type]=assets[pathname];
        res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self' ws:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
        return fs.createReadStream(path.join(__dirname,'public',file)).pipe(res);
      }
    }
    const upstream=http.request({hostname:'127.0.0.1',port,path:req.url,method:req.method,headers:headersFor(req,port)},reply=>{
      const h={};for(const [k,v] of Object.entries(reply.headers)) if(!hop.has(k)) h[k]=v;
      h['referrer-policy']='no-referrer';h['x-frame-options']='DENY';
      res.writeHead(reply.statusCode,h);reply.pipe(res);
      reply.on('error',()=>res.destroy());
    });
    upstream.on('error',()=>{if(!res.headersSent)json(res,503,{error:'モデルが停止しています。管理ページから起動してください。'});else res.destroy();});
    req.pipe(upstream);req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());
  });
  server.on('upgrade',(req,socket,head)=>{
    if(port===8188){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
    if(port!==8188 || !admitted(req)||!ownOrigin(req)||!req.url.startsWith('/')||req.url.startsWith('//')) {socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
    const h=headersFor(req,port);h.connection='Upgrade';h.upgrade='websocket';
    const up=http.request({hostname:'127.0.0.1',port,path:req.url,method:'GET',headers:h});
    up.on('upgrade',(reply,upSocket,upHead)=>{
      let raw='HTTP/1.1 101 Switching Protocols\r\n';for(const [k,v] of Object.entries(reply.headers))raw+=k+': '+v+'\r\n';socket.write(raw+'\r\n');
      if(upHead.length)socket.write(upHead);if(head.length)upSocket.write(head);
      socket.pipe(upSocket);upSocket.pipe(socket);socket.on('error',()=>upSocket.destroy());upSocket.on('error',()=>socket.destroy());socket.on('close',()=>upSocket.destroy());upSocket.on('close',()=>socket.destroy());
    });
    up.on('error',()=>socket.destroy());up.on('response',()=>socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));up.end();
  });
  server.requestTimeout=0;return server;
}
const listeners=[];
privateImages=require('./private-images.cjs')({isWorkspaceRequest:req=>workspaceRequests.has(req),cfg,json,ownOrigin,getToken:()=>token,getJob:()=>job,status,root:__dirname});
studio=require('./studio.cjs')({cfg,admitted,ownOrigin,json,status,action,headersFor,getToken:()=>token,getJob:()=>job,privateImages,queueBypass,ticketMatches:(id,peer,model)=>scheduler?.owns(id,peer,model),stopChatBackend:async()=>{await runScript('C:/AI/llama.cpp/Stop-Gemma.ps1','-Quiet');cachedAt=0;}});
bootTest=require('./boot-test.cjs')({root:__dirname,cfg,ps,action,getToken:()=>token,privateImages,getStatus:async()=>({...await status(true),...studio.activity(),privateImageBusy:privateImages.busy(),job,lastJob})});
stabilityTest=require('./stability-test.cjs')({root:__dirname,cfg,ps,action,getToken:()=>token,privateImages,getStatus:async()=>({...await status(true),...studio.activity(),privateImageBusy:privateImages.busy(),job,lastJob}),stopImages:async()=>{await runScript('C:/AI/NoctQ/Stop-NoctQ.ps1','-Quiet');cachedAt=0;},stopAll:async()=>{await runScript('C:/AI/llama.cpp/Stop-Gemma.ps1','-Quiet');await runScript('C:/AI/NoctQ/Stop-NoctQ.ps1','-Quiet');cachedAt=0;}});
scheduler=require('./shared-queue.cjs')({json,ownOrigin,getToken:()=>token,getState:async()=>({...await status(true),...studio.activity(),privateImageBusy:privateImages.busy(),job,bootTest:bootTest.publicStatus(),stabilityTest:stabilityTest.publicStatus()})});
async function listen(server,port,host) {
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  listeners.push(server);server.on('error',e=>log('LISTENER ERROR '+e.message));
}
(async()=>{
  const listenHosts=['127.0.0.1'];
  if(Object.values(os.networkInterfaces()).flat().some(address=>address?.address===cfg.meshIp))listenHosts.push(cfg.meshIp);
  for(const host of listenHosts) {
    const dashboardServer=http.createServer((req,res)=>dashboard(req,res).catch(e=>{log('HTTP ERROR '+e.message);if(!res.headersSent)json(res,500,{error:'状態の取得に失敗しました。'});else res.destroy();}));
    dashboardServer.on('upgrade',studio.upgrade);
    await listen(dashboardServer,cfg.dashboardPort,host);
    await listen(makeProxy(8080),cfg.chatPort,host);
    await listen(makeProxy(8188),cfg.imagePort,host);
  }
  require('./workspace-lllm.cjs')({root:__dirname,dispatch:dashboard,getToken:()=>token,markRequest:req=>workspaceRequests.add(req)});
  log('READY http://'+cfg.meshIp+':'+cfg.dashboardPort);
  stabilityTest.start().catch(()=>{log('STABILITY TEST INTERRUPTED');});
  bootTest.start().catch(error=>{bootTest.fail(error);log('BOOT TEST FAILED');});
})().catch(e=>{log('START FAILED '+e.message);for(const s of listeners)s.close();process.exit(1);});
process.on('SIGTERM',()=>{for(const s of listeners)s.close();process.exit(0);});
