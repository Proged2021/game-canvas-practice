const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const envelope=require('./image-envelope.cjs');
const EncryptedMemory=require('./encrypted-memory.cjs');
module.exports=function privateImages(ctx){
 const {cfg,json,ownOrigin,getToken,getJob,status,root}=ctx;
 const state=path.join(root,'state'),results=new EncryptedMemory(),viewReceipts=new Map();
 const authPath=path.join(state,'private-control-token');
 if(!fs.existsSync(authPath))fs.writeFileSync(authPath,crypto.randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});
 const control=fs.readFileSync(authPath,'utf8').trim();
 const keysPath=path.join(state,'image-public-keys.json');
 let keys=fs.existsSync(keysPath)?JSON.parse(fs.readFileSync(keysPath,'utf8')):[];
 const jobs=new Map(),references=new Map(),diagnosticKeys=new Map(),sessionKeys=new Map();
 const peer=req=>(req.socket.remoteAddress||'').replace(/^::ffff:/,'');
 const external=req=>ctx.isWorkspaceRequest?.(req)||cfg.allowedPeers.includes(peer(req));
 const writeAllowed=req=>ownOrigin(req)&&req.headers['x-control-token']===getToken();
 const backendHeaders=extra=>({'X-AI-Private-Token':control,...extra});
 const busy=()=>[...jobs.values()].some(j=>['preparing','queued','sealing'].includes(j.state));
 function persist(file,data){const next=file+'.new';fs.writeFileSync(next,JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(next,file);}
 async function backend(route,options={}){
  const response=await fetch('http://127.0.0.1:8188'+route,{...options,headers:backendHeaders(options.headers),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('画像エンジンの保護処理に失敗しました（'+response.status+'）。');
  return response.json();
 }
 async function read(req,limit){let n=0,parts=[];try{for await(const p of req){n+=p.length;if(n>limit){p.fill(0);throw Error('入力が大きすぎます。');}parts.push(p);}return Buffer.concat(parts);}finally{for(const p of parts)p.fill(0);}}
 async function readJson(req){return JSON.parse((await read(req,65536)).toString('utf8'));}
 function keyById(id){return keys.find(k=>k.id===id)||diagnosticKeys.get(id)||sessionKeys.get(id);}
 function pruneSessions(){for(const[id,k]of sessionKeys)if((k.released||k.expiresAt<Date.now())&&![...jobs.values()].some(j=>j.recipient===id&&['preparing','queued','sealing'].includes(j.state)))sessionKeys.delete(id);}
 function jobFor(req,id){const j=jobs.get(id);return j&&j.owner===peer(req)?j:null;}
 async function discardReference(id){references.delete(id);try{await backend('/private-studio/reference/'+id,{method:'DELETE'});}catch{}}
 async function clearHistory(j){
  if(j.diagnostic&&!j.diagnosticFinished)return;
  if(j.historyCleared||!j.promptId)return;
  const history=await backend('/history/'+j.promptId);
  const outcome=history[j.promptId]?.status;
  if(!outcome?.completed&&outcome?.status_str!=='error')return;
  await backend('/history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({delete:[j.promptId]})});j.historyCleared=true;
 }
 async function monitor(j){
  if(j.refreshing)return;j.refreshing=true;
  try{
   if(j.state==='queued'&&j.promptId){try{const h=await backend('/history/'+j.promptId),result=h[j.promptId];if(j.state==='queued'&&(result?.status?.status_str==='error'||result?.status?.completed)){j.state='failed';j.error='画像処理または暗号化保存が完了しませんでした。';}}catch{if(j.state==='queued'){j.state='failed';j.error='画像エンジンとの接続が切れました。';}}}
   if(['completed','failed'].includes(j.state)){
    if(j.reference&&!j.referenceCleared){await discardReference(j.reference);j.referenceCleared=true;}
    try{await clearHistory(j);}catch{}
   }
  }finally{j.refreshing=false;}
 }
 async function submit(req,res){
  if(busy()||getJob())return json(res,409,{error:'別の画像処理またはモデル切り替えが進行中です。'});
  const b=await readJson(req),key=keyById(b.recipient);
  if(!key||(key.ephemeral&&key.owner!==peer(req))||!['generate','edit'].includes(b.mode)||typeof b.prompt!=='string'||!b.prompt.trim()||b.prompt.length>5000)return json(res,400,{error:'送信先の公開鍵と説明を確認してください。'});
  if(b.mode==='edit'&&(!references.has(b.reference)||references.get(b.reference).owner!==peer(req)))return json(res,400,{error:'参照画像をもう一度送信してください。'});
  const ready=await status(true);if(!ready.imageRunning||getJob()||busy())return json(res,409,{error:'画像生成モデルの準備が完了してから再実行してください。'});
  const id=crypto.randomUUID(),j={id,owner:peer(req),recipient:key.id,reference:b.reference,mode:b.mode,state:'preparing',createdAt:new Date().toISOString(),token:crypto.randomBytes(32).toString('hex')};jobs.set(id,j);
  try{
   const graph=JSON.parse(fs.readFileSync(path.join(root,'public','studio-workflows.json'),'utf8'))[b.mode];
   const sizes=[512,768,1024],resolution=sizes.includes(Number(b.resolution))?Number(b.resolution):(b.mode==='edit'?768:1024);
   graph['4'].inputs.prompt=b.prompt;graph['4'].inputs.negative_prompt=String(b.negative||'').slice(0,5000);graph['4'].inputs.resolution=resolution;
   graph['6'].inputs.steps=Math.min(40,Math.max(10,Number(b.steps)||25));graph['6'].inputs.cfg=Math.min(8,Math.max(1,Number(b.cfg)||3));graph['6'].inputs.seed=crypto.randomInt(0,0xffffffff);
   graph['8']={class_type:'PrivateStudioOutput',inputs:{images:['7',0],job_id:id,save_token:j.token}};
   if(b.mode==='edit')graph['10']={class_type:'PrivateStudioReference',inputs:{reference_id:b.reference}};
   else{const ratios=[1,.75,4/3,.5625,16/9],ratio=ratios.find(r=>Math.abs(r-Number(b.ratio))<.0001)||1;graph['5'].inputs.width=Math.round(resolution*Math.sqrt(ratio)/32)*32;graph['5'].inputs.height=Math.round(resolution/Math.sqrt(ratio)/32)*32;}
   const result=await backend('/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:graph,client_id:String(b.clientId||'').slice(0,100)})});
   j.promptId=result.prompt_id;if(j.state==='preparing')j.state='queued';if(b.reference)references.delete(b.reference);
   return json(res,202,{id,promptId:j.promptId});
  }catch(e){j.state='failed';j.error=e.message;if(b.reference)await discardReference(b.reference);throw e;}
 }
 async function seal(req,res,id){
  const j=jobs.get(id);
  if(peer(req)!=='127.0.0.1'||!j||!['preparing','queued'].includes(j.state)||req.headers.authorization!=='Bearer '+j.token)return json(res,403,{error:'Forbidden'});
  j.state='sealing';const key=keyById(j.recipient);let chunks=[],sealed=null,retained=false;
  try{
   const {cipher,prefix,viewProof}=envelope.begin(key.publicKey,j);chunks.push(prefix);let length=0;
   for await(const chunk of req){try{length+=chunk.length;if(length>40*1024*1024)throw Error('Result is too large');chunks.push(cipher.update(chunk));}finally{chunk.fill(0);}}
   if(!length)throw Error('Empty result');chunks.push(cipher.final(),cipher.getAuthTag());sealed=Buffer.concat(chunks);
   results.put(id,sealed,{id,recipient:j.recipient,mode:j.mode,createdAt:j.createdAt});retained=true;
   viewReceipts.set(id,{proof:Buffer.from(viewProof,'base64'),expiresAt:null});
   j.state='completed';j.token=null;json(res,200,{id});
  }catch(e){j.state='failed';j.error='暗号化した結果の受け渡し準備が完了しませんでした。';json(res,500,{error:'Encryption failed'});}
  finally{for(const chunk of chunks)chunk.fill(0);if(sealed&&!retained)sealed.fill(0);}
 }
 async function handle(req,res){
  const url=new URL(req.url,'http://localhost'),p=url.pathname;
  if(p.startsWith('/internal/private/result/')){await seal(req,res,p.split('/').pop());return true;}
  if(p.startsWith('/api/image/')&&!['/api/image/queue','/api/image/system_stats'].includes(p)){json(res,403,{error:'平文画像を扱う経路は無効です。保護された画像操作を使ってください。'});return true;}
  if(!p.startsWith('/api/private/'))return false;
  if(!ownOrigin(req)||(req.method!=='GET'&&!writeAllowed(req))){json(res,403,{error:'ページを再読み込みしてください。'});return true;}
  try{
   if(req.method==='GET'&&p==='/api/private/status')json(res,200,{enabled:true,canUnlock:external(req),recipients:(ctx.isWorkspaceRequest?.(req)?[]:keys).map(({id,label,publicKey})=>({id,label,publicKey})),algorithm:'AES-256-GCM / X25519',active:busy(),resultStorage:'encrypted-memory',retentionSeconds:results.ttlMs/1000,bufferedResults:results.entries.size});
   else if(req.method==='POST'&&p==='/api/private/session/release'){
    const b=await readJson(req),k=sessionKeys.get(b.id);
    if(!external(req)||!k||k.owner!==peer(req))json(res,403,{error:'Forbidden'});
    else{k.released=true;pruneSessions();json(res,200,{released:true});}
   }
   else if(req.method==='POST'&&p==='/api/private/session'){
    if(!external(req))json(res,403,{error:'このPCでは画像を復号しません。外部端末でページを開いてください。'});
    else{
     const b=await readJson(req),id=envelope.recipientId(b.publicKey);pruneSessions();const existing=keyById(id);
     if(existing&&(!existing.ephemeral||existing.owner!==peer(req)))json(res,409,{error:'表示用の一時鍵を作り直してください。'});
     else if(!existing&&(sessionKeys.size>=32||[...sessionKeys.values()].filter(k=>k.owner===peer(req)).length>=4))json(res,429,{error:'この端末で開いている画像ページが多すぎます。しばらく待ってから再度お試しください。'});
     else{sessionKeys.set(id,{id,publicKey:b.publicKey,ephemeral:true,owner:peer(req),expiresAt:Date.now()+3600000});json(res,200,{id,ephemeral:true});}
    }
   }
   else if(req.method==='POST'&&p==='/api/private/keys'){
    if(!external(req))json(res,403,{error:'復号鍵の設定は外部端末から行ってください。'});
    else{const b=await readJson(req),id=envelope.recipientId(b.publicKey);let k=keyById(id);if(!k){k={id,label:String(b.label||'外部端末').slice(0,40),publicKey:b.publicKey};keys.push(k);persist(keysPath,keys);}json(res,200,{id,label:k.label});}
   }else if(req.method==='POST'&&p==='/api/private/reference'){
    if(!external(req))return json(res,403,{error:'参照画像は外部端末から送信してください。'}),true;
    if(busy()||getJob())return json(res,409,{error:'画像処理が完了してから送信してください。'}),true;
    if(!['image/png','image/jpeg','image/webp'].includes(req.headers['content-type']))return json(res,400,{error:'PNG・JPEG・WebPを選んでください。'}),true;
    if(references.size>=4)return json(res,409,{error:'一時画像が残っています。2分後に再度お試しください。'}),true;
    const data=await read(req,20*1024*1024),id=crypto.randomBytes(24).toString('hex');
    try{await backend('/private-studio/reference/'+id,{method:'PUT',headers:{'Content-Type':req.headers['content-type']},body:data});references.set(id,{owner:peer(req),expires:Date.now()+120000});json(res,200,{id});}finally{data.fill(0);}
   }else if(req.method==='POST'&&p==='/api/private/jobs')await submit(req,res);
   else if(req.method==='GET'&&/^\/api\/private\/jobs\/[a-f0-9-]{36}$/.test(p)){
    const j=jobFor(req,p.split('/').pop());if(!j)json(res,404,{error:'処理が見つかりません。'});
    else{
     await monitor(j);
     if(j.state==='completed'&&!results.get(j.id)){j.state='expired';j.error='一時保管期限が切れました。画像を再生成してください。';}
     json(res,200,{id:j.id,promptId:j.promptId,state:j.state,recipient:j.recipient,error:j.error,file:j.state==='completed'?'/api/private/files/'+j.id:null});
    }
   }else if(req.method==='POST'&&/^\/api\/private\/files\/[a-f0-9-]{36}\/viewed$/.test(p)){
    const id=p.split('/')[4],record=viewReceipts.get(id),entry=results.get(id),b=await readJson(req),proof=typeof b.proof==='string'&&b.proof.length===44?Buffer.from(b.proof,'base64'):Buffer.alloc(0);
    try{
     if(!external(req)||(ctx.isWorkspaceRequest?.(req)&&!jobFor(req,id))||!record||!entry||proof.length!==32||!crypto.timingSafeEqual(record.proof,proof))json(res,403,{error:'表示の確認に失敗しました。'});
     else{if(!record.expiresAt)record.expiresAt=results.shorten(id,120000);json(res,200,{expiresAt:record.expiresAt,displaySeconds:120});}
    }finally{proof.fill(0);}
   }else if(req.method==='GET'&&p==='/api/private/files')json(res,200,{files:results.list(url.searchParams.get('recipient')).filter(item=>!ctx.isWorkspaceRequest?.(req)||jobFor(req,item.id))});
   else if(req.method==='GET'&&/^\/api\/private\/files\/[a-f0-9-]{36}$/.test(p)){
    const id=p.split('/').pop(),entry=(!ctx.isWorkspaceRequest?.(req)||jobFor(req,id))?results.acquire(id):null;if(!entry)json(res,404,{error:'暗号化した結果の一時保管期限が切れたか、再起動で消去されました。'});
    else{results.shorten(id,120000);res.on('close',entry.release);res.on('finish',entry.release);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="'+id+'.aistudio"','Content-Length':entry.data.length,'Cache-Control':'no-store, no-cache, must-revalidate','Pragma':'no-cache','X-Content-Type-Options':'nosniff'});res.end(entry.data);}
   }else json(res,404,{error:'この操作はありません。'});
  }catch(e){if(!res.headersSent)json(res,400,{error:e.message});else res.destroy();}
  return true;
 }
 const expiryTimer=setInterval(()=>{results.prune();for(const[id,record]of viewReceipts)if(!results.get(id)){record.proof.fill(0);viewReceipts.delete(id);}},1000);expiryTimer.unref();
 const timer=setInterval(()=>{results.prune();pruneSessions();for(const[id,r]of references)if(r.expires<Date.now())discardReference(id);for(const[id,j]of jobs){monitor(j).catch(()=>{});if(['completed','failed','expired'].includes(j.state)&&Date.now()-Date.parse(j.createdAt)>3600000)jobs.delete(id);}},5000);timer.unref();
 // Only the in-process, once-per-boot verifier calls this. No HTTP route can
 // register these throwaway public keys or obtain the test reference.
 async function diagnosticImage({mode,publicKey,reference,resolution=512,steps=10,timeoutMs=1200000}){
  if(!['generate','edit'].includes(mode)||busy()||getJob())throw Error('Diagnostic engine is busy');
  const recipient=envelope.recipientId(publicKey),referenceId=mode==='edit'?crypto.randomBytes(24).toString('hex'):null;
  if(keyById(recipient))throw Error('Diagnostic key must be fresh');
  diagnosticKeys.set(recipient,{id:recipient,publicKey});let id;
  try{
   if(referenceId){
    await backend('/private-studio/reference/'+referenceId,{method:'PUT',headers:{'Content-Type':'image/png'},body:reference});
    references.set(referenceId,{owner:'127.0.0.1',expires:Date.now()+120000});
   }
   const request=require('node:stream').Readable.from([Buffer.from(JSON.stringify({recipient,mode,reference:referenceId,prompt:mode==='edit'?'Change the blue circle to a red square on the plain white background. Simple flat geometric shapes, no text, no people.':'A single blue circle centered on a plain white background. Simple flat geometric icon, no text, no people.',resolution:[512,768,1024].includes(resolution)?resolution:512,ratio:1,steps:Math.min(25,Math.max(10,steps)),cfg:3,clientId:'local-boot-diagnostic'}))]);
   request.socket={remoteAddress:'127.0.0.1'};request.headers={};
   let code,response;
   await submit(request,{writeHead(value){code=value;},end(value){response=JSON.parse(value);}});
   if(code!==202)throw Error(response?.error||'Diagnostic submission failed');
   id=response.id;const j=jobs.get(id),deadline=Date.now()+timeoutMs;j.diagnostic=true;
   while(Date.now()<deadline){
    await monitor(j);
    if(j.state==='completed'){
     const entry=results.get(id);if(!entry)throw Error('Diagnostic ciphertext missing');
     return Buffer.from(entry.data);
    }
    if(j.state==='failed'){
     let detail='';
     try{const h=await backend('/history/'+j.promptId);const e=h[j.promptId]?.status?.messages?.find(m=>m[0]==='execution_error')?.[1];if(e)detail=' '+String(e.exception_type)+': '+String(e.exception_message).slice(0,500);}catch{}
     throw Error((j.error||'Diagnostic image execution failed')+detail);
    }
    await new Promise(r=>setTimeout(r,2000));
   }
   throw Error('Diagnostic image execution timed out');
  }finally{
   if(id){const j=jobs.get(id);if(j){if(!['completed','failed'].includes(j.state)){j.state='failed';j.token=null;}j.diagnosticFinished=true;try{for(let n=0;n<20&&!j.historyCleared;n++){await clearHistory(j);if(!j.historyCleared)await new Promise(r=>setTimeout(r,500));}}catch{}jobs.delete(id);}results.remove(id);}
   if(referenceId)await discardReference(referenceId);
   diagnosticKeys.delete(recipient);
  }
 }
 return {handle,backendHeaders,busy,diagnosticImage};
};
