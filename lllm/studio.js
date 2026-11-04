const $=id=>document.getElementById(id);
const NEG={generate:'blurry, low quality, low resolution, artifacts, distorted, watermark, unreadable text',edit:'blurry, low quality, distorted, artifacts, watermark'};
const ui={server:null,busy:null,file:null,preview:null,history:[],lastReply:'',abort:null,imageJob:null,ws:null,polling:false,first:true,modelsSignature:'',revoked:false,accessStatus:0};
let statusTimer=null;
const clientId='studio-'+Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
const nap=ms=>new Promise(r=>setTimeout(r,ms));
// Match the controller's bounded admission/start budgets, including cold WSL startup.
// Stop requests retain the shorter existing limit.
function modelOperationBudgetMs(model,action='start'){return action==='stop'?450000:(model==='noctq'?2760000:1860000);}
function note(mode,text,error=false){if(ui.revoked)return;const e=$(mode+'Status');e.textContent=text;e.className='notice'+(error?' error':'');}
function message(role,text){if(ui.revoked)return null;const area=$('messages');if(!area.querySelector('.bubble'))area.replaceChildren();const wrap=document.createElement('article');wrap.className='bubble '+role;const label=document.createElement('span');label.className='speaker';label.textContent=role==='user'?'YOU':'AI';const body=document.createElement('div');body.className='content';body.textContent=text;wrap.append(label,body);area.append(wrap);area.scrollTop=area.scrollHeight;return body;}
function selectTab(tab){if(!['chat','generate','edit'].includes(tab))tab='chat';document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===tab)));for(const key of ['chat','generate','edit'])$(key+'Panel').hidden=key!==tab;document.querySelector('.vaultpanel').hidden=ui.revoked||tab==='chat';if(location.hash!=='#'+tab)history.replaceState(null,'','#'+tab);}
function accessError(){const error=Error('LLLMの利用権限を確認できません。ワークスペースへ戻って確認してください。');error.status=ui.accessStatus||403;error.code='LLLM_ACCESS_REVOKED';return error;}
function connectionNotice(title,text,terminal=false){
 const panel=$('connectionNotice');panel.hidden=false;const heading=panel.querySelector('h2');if(heading)heading.textContent=title;
 $('connectionMessage').textContent=text;
 for(const paragraph of panel.querySelectorAll('p'))if(paragraph!==$('connectionMessage')){paragraph.hidden=terminal;paragraph.textContent='接続状態だけを定期的に確認します。この画面から自動でモデルを起動することはありません。';}
 $('retryConnection').textContent=terminal?'ワークスペースへ戻る':'接続状態を確認';
}
function clearSensitiveContents(){
 ui.abort?.abort();ui.abort=null;ui.history=[];ui.lastReply='';ui.file=null;ui.imageJob=null;ui.ws?.close();ui.ws=null;
 if(ui.preview)URL.revokeObjectURL(ui.preview);ui.preview=null;
 $('editImage').value='';$('editPreview').hidden=true;$('editPreview').removeAttribute('src');$('editUploadLabel').textContent='＋ 編集したい画像を選ぶ（任意）';$('messages').replaceChildren();
 for(const id of ['chatInput','systemPrompt','generatePrompt','generateNegative','editPrompt','editNegative'])$(id).value='';
 for(const mode of ['chat','generate','edit']){$(mode+'Status').textContent='';$(mode+'QueueHint').textContent='';}
 for(const mode of ['generate','edit']){$(mode+'Progress').hidden=true;$(mode+'Output').removeAttribute('src');$(mode+'Output').hidden=true;$(mode+'Download').removeAttribute('href');$(mode+'Download').hidden=true;$(mode+'EncryptedDownload').removeAttribute('href');$(mode+'UnlockResult').hidden=true;}
 PrivateImages.clear();
}
function revokeAccess(detail={}){
 if(ui.revoked)return;ui.revoked=true;ui.accessStatus=detail.status||403;clearInterval(statusTimer);statusTimer=null;
 clearSensitiveContents();ui.server=null;ui.busy=null;$('models').replaceChildren();$('memory').textContent='';$('modelNotice').textContent='';
 void GpuQueue.release().catch(()=>{});GpuQueue.update(null);$('queuePanel').hidden=true;document.querySelector('.vaultpanel').hidden=true;
 $('machineStatus').textContent=ui.accessStatus===401?'ログインを確認してください':'LLLMの利用を停止しました';$('machineStatus').parentElement.classList.add('offline');
 connectionNotice('LLLMを利用できません',(detail.message||'利用権限を確認できませんでした。')+' ログインと、水無墓村・このワークスペースへの参加状態を確認し、ワークスペースの拡張機能から開き直してください。',true);
 $('retryConnection').disabled=false;controls();
}
window.addEventListener('lllmaccessrevoked',event=>revokeAccess(event.detail));
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>selectTab(b.dataset.tab)));
window.addEventListener('hashchange',()=>selectTab(location.hash.slice(1)));selectTab(location.hash.slice(1)||'chat');
function controls(){
 const s=ui.revoked?null:ui.server;const other=!!(s?.bootTest?.active||s?.stabilityTest?.active);
 $('sendChat').disabled=!!ui.busy||!s||other||!$('chatInput').value.trim();
 $('runGenerate').disabled=!!ui.busy||!s||other||!PrivateImages.ready()||!$('generatePrompt').value.trim();
 $('runEdit').disabled=!!ui.busy||!s||other||!PrivateImages.ready()||(!!ui.file&&!PrivateImages.canUnlock())||!$('editPrompt').value.trim();
 const waiting=GpuQueue.isWaiting(),sharedBusy=!!(s?.scheduler?.active||s?.scheduler?.waiting),turn=GpuQueue.view();for(const mode of ['chat','generate','edit']){const hint=$(mode+'QueueHint'),mine=ui.busy===mode;hint.textContent=!s?'AIサーバーに接続すると送信できます。':mine&&waiting?'順番待ち：'+turn.position+'番目 · 前に'+turn.ahead+'件。自動で始まります。':mine&&turn?.state==='granted'?'あなたの番です。準備・処理中です。':mine?'順番の受付中です…':sharedBusy?'ほかの依頼を処理中です。送信して順番待ちに入れます。':'受付できます。混雑時は自動で順番待ちになります。';hint.className='task-queue-hint'+(mine&&waiting?' waiting':mine?' active':'');}$('editResultTitle').textContent=ui.file?'編集した画像':'仕上がった画像';$('sendChat').textContent=ui.busy==='chat'?(waiting?'順番待ち中…':'返答を作成中…'):(sharedBusy?'順番待ちで送信する':'送信する');
 $('runGenerate').textContent=ui.busy==='generate'?(waiting?'順番待ち中…':'生成中…'):(sharedBusy?'順番待ちで生成する':'画像を生成する');$('runEdit').textContent=ui.busy==='edit'?(waiting?'順番待ち中…':ui.file?'編集中…':'生成中…'):(ui.file?(sharedBusy?'順番待ちで編集する':'この画像を編集する'):(sharedBusy?'順番待ちで生成する':'説明から画像を生成する'));
 $('clearEditImage').hidden=!ui.file;$('clearEditImage').disabled=!!ui.busy;
 document.querySelectorAll('.workspace textarea,.workspace input,.workspace select,[data-reset],#newChat').forEach(e=>e.disabled=ui.revoked||!!ui.busy);
 $('stopChat').hidden=!ui.abort;$('copyChat').disabled=!ui.lastReply;
 document.querySelectorAll('#models button').forEach(b=>b.disabled=ui.revoked||!s||!!ui.busy||other);
 if(ui.revoked)for(const mode of ['chat','generate','edit'])$(mode+'QueueHint').textContent='利用権限を確認するまで実行できません。';
}
function renderStatus(s){
 if(ui.revoked)return;
 GpuQueue.update(s.scheduler);
 ui.server=s;if($('stabilityTestStatus')){const e=$('stabilityTestStatus'),t=s.stabilityTest;e.hidden=!t;e.textContent=t?(t.active?'GPU動作確認中 · '+Math.floor((t.elapsedSeconds||0)/60)+' / 20分 · ':'')+(t.phase||''):'';e.className='notice'+(t?.state==='failed'||t?.state==='interrupted'?' error':'');}const active=s.models.filter(m=>m.running).map(m=>m.name).join(' / ');
 if($('bootTestStatus')){const b=s.bootTest,e=$('bootTestStatus');e.hidden=!b;e.textContent=b?b.summary+(b.active?'（確認中は生成操作をお待ちください）':''):'';e.className='notice'+(b?.state==='failed'||b?.state==='interrupted'?' error':'');}
 $('machineStatus').textContent=s.job?s.job.label:s.chatBusy?'文章を生成中':s.queueRunning?'画像を生成中':active?active+' 稼働中':'準備OK';
 $('machineStatus').parentElement.classList.remove('offline');$('memory').textContent='メモリ空き '+s.memory.freeGiB+' / '+s.memory.totalGiB+' GB';
 if(ui.first){if(s.current)$('chatModel').value=s.current;$('temperature').value=$('chatModel').value==='gemma'?1:.7;ui.first=false;}
 const sig=JSON.stringify(s.models)+!!s.job;
 if(sig!==ui.modelsSignature){ui.modelsSignature=sig;$('models').replaceChildren();for(const m of s.models){const row=document.createElement('div');row.className='modelrow';const name=document.createElement('span');name.textContent=m.name;const state=document.createElement('small');state.textContent=m.running?'稼働中':'停止中';const b=document.createElement('button');b.className='secondary';b.dataset.model=m.id;b.dataset.action=m.running?'stop':'start';b.textContent=m.running?'停止':'起動';row.append(name,state,b);$('models').append(row);}}
 controls();
}
async function api(url,options={}){if(ui.revoked)throw accessError();const headers={...(options.headers||{})};if(options.method==='POST')headers['X-Control-Token']=ui.server?.actionToken||'';const ticket=GpuQueue.ticket();if(ticket)headers['X-AI-Ticket']=ticket;const r=await fetch(url,{cache:'no-store',...options,headers});if(ui.revoked)throw accessError();let data;try{data=await r.json();}catch{throw Error('PCからの応答を読み取れません。少し待ってもう一度お試しください。');}if(ui.revoked)throw accessError();if(!r.ok){const reason=data.error,error=Error(typeof reason==='string'?reason:reason?.message||'処理に失敗しました。設定を初期値に戻してお試しください。');error.status=r.status;error.code=data.code||'LLLM_HTTP_'+r.status;throw error;}return data;}
async function freshStatus(){const s=await api('/api/status');renderStatus(s);return s;}
async function ensureModel(id,mode){
 const deadline=Date.now()+modelOperationBudgetMs(id);let requestId=null;
 while(Date.now()<deadline){const s=await freshStatus();if(!s.job&&(id==='noctq'?s.imageRunning:s.current===id))return;
  if(requestId&&s.lastJob?.id===requestId&&!s.lastJob.ok)throw Error(s.lastJob.message);
  if(s.job){note(mode,s.job.label+'… このままお待ちください。');await nap(1400);continue;}
  const r=await api('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'start',model:id})});requestId=r.job?.id||null;
  note(mode,(s.models.find(m=>m.id===id)?.name||'モデル')+'を準備しています… 初回は数分かかる場合があります。');await nap(1400);
 }
 throw Error('モデルの準備に時間がかかっています。モデル管理から状態を確認してください。');
}
async function refresh(){if(ui.revoked||ui.polling)return;ui.polling=true;$('retryConnection').disabled=true;try{await freshStatus();if(!PrivateImages.ready())await PrivateImages.refresh();if(ui.revoked)return;$('connectionNotice').hidden=true;if(ui.imageJob)await imageHistory();}catch(e){if(ui.revoked)return;ui.server=null;$('machineStatus').parentElement.classList.add('offline');if(e.status===503){$('machineStatus').textContent='AIサーバーは停止中・接続なし';connectionNotice('AIサーバーへ接続できません','AIサーバーが停止中、または接続できないため、生成は実行できません。'+(e.message||''));}else if([401,403,404].includes(e.status)){$('machineStatus').textContent='ログイン・参加状態を確認してください';connectionNotice('ログインと利用権限を確認してください',e.message||'水無墓村と、このワークスペースへの参加状態を確認してください。');}else{$('machineStatus').textContent='ネットワークに接続できません';connectionNotice('通信状態を確認してください',e.message||'ネットワークを確認してください。入力した内容は送信していません。');}controls();}finally{ui.polling=false;$('retryConnection').disabled=false;}}
$('retryConnection').addEventListener('click',()=>{if(!ui.revoked){void refresh();return;}let target='/';try{const slug=document.querySelector('meta[name="lllm-workspace"]')?.content;if(slug)target='/w/'+encodeURIComponent(decodeURIComponent(slug));}catch{}location.assign(target);});
for(const id of ['chatInput','generatePrompt','editPrompt'])$(id).addEventListener('input',controls);
$('chatModel').addEventListener('change',()=>{$('temperature').value=$('chatModel').value==='gemma'?1:.7;});
$('models').addEventListener('click',async event=>{const b=event.target.closest('button[data-model]');if(!b||ui.busy||ui.revoked)return;ui.busy='model';controls();let succeeded=false;try{await GpuQueue.acquire(b.dataset.model);await freshStatus();const r=await api('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:b.dataset.action,model:b.dataset.model})});$('modelNotice').textContent=r.message;if(r.code===202){const deadline=Date.now()+modelOperationBudgetMs(b.dataset.model,b.dataset.action);while(Date.now()<deadline){await nap(1400);const s=await freshStatus();if(!s.job){if(s.lastJob?.id===r.job.id&&!s.lastJob.ok)throw Error(s.lastJob.message);break;}}if(ui.server?.job)throw Error('モデルの状態を確認中です。');}succeeded=true;}catch(e){if(!ui.revoked)$('modelNotice').textContent=e.message;}finally{await GpuQueue.release(succeeded);ui.busy=null;controls();await refresh();}});
$('newChat').addEventListener('click',()=>{if(ui.busy||ui.revoked)return;ui.history=[];ui.lastReply='';$('chatInput').value='';$('messages').replaceChildren();const blank=document.createElement('div');blank.className='empty';blank.textContent='新しい会話を始めましょう。';$('messages').append(blank);note('chat','メッセージを入力してください。');controls();});
$('copyChat').addEventListener('click',async()=>{if(ui.revoked||!ui.lastReply)return;try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(ui.lastReply);else{const t=document.createElement('textarea');try{t.value=ui.lastReply;t.className='clipboard';document.body.append(t);t.select();if(!document.execCommand('copy'))throw Error();}finally{t.value='';t.remove();}}if(!ui.revoked)note('chat','返答をコピーしました。');}catch{if(!ui.revoked)note('chat','返答の文字を選択してコピーしてください。');}});
$('stopChat').addEventListener('click',()=>ui.abort?.abort());
$('chatInput').addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'&&!$('sendChat').disabled){event.preventDefault();$('sendChat').click();}});
$('sendChat').addEventListener('click',async()=>{
 const text=$('chatInput').value.trim();if(!text||ui.busy||ui.revoked)return;ui.busy='chat';controls();let answer='',reply=null,succeeded=false;
 const selected=$('chatModel').value;
 try{
  note('chat','受付後は順番が来ると自動で始まります。');await GpuQueue.acquire(selected);await ensureModel(selected,'chat');note('chat','返答を作成しています…');
  let history=ui.history.slice(-10);while(history.reduce((n,m)=>n+m.content.length,0)>8000&&history.length>2)history=history.slice(2);
  const messages=[...($('systemPrompt').value.trim()?[{role:'system',content:$('systemPrompt').value.trim()}]:[]),...history,{role:'user',content:text}];
  ui.abort=new AbortController();controls();
  let buffer='',completed=false;
  function consume(line){if(!line.startsWith('data:'))return;const raw=line.slice(5).trim();if(!raw)return;if(raw==='[DONE]'){completed=true;return;}let data;try{data=JSON.parse(raw);}catch{throw Error('返答の形式を確認できません。');}if(data.error)throw Error(data.error.message||data.error);const delta=data.choices?.[0]?.delta;if(delta?.content){answer+=delta.content;reply.textContent=answer;$('messages').scrollTop=$('messages').scrollHeight;}else if(delta?.reasoning_content)note('chat','考えています…');}
  await ChatCrypto.send({model:selected,messages,temperature:Number($('temperature').value),max_tokens:Number($('maxTokens').value)},{token:ui.server.actionToken,ticket:GpuQueue.ticket(),signal:ui.abort.signal,onAccepted(){if(ui.revoked)return;$('chatInput').value='';message('user',text);reply=message('assistant','');},onText(part){if(ui.revoked)return;buffer+=part;let pos;while((pos=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,pos).replace(/\r$/,''));buffer=buffer.slice(pos+1);}}});
  if(ui.revoked)return;
  if(buffer)consume(buffer);if(!answer||!completed)throw Error('返答が完了しませんでした。もう一度送信してください。');succeeded=true;note('chat','返答をこの端末で復号しました。PC側の一時バッファ上書きと処理終了を確認しました。');
 }catch(e){if(e.name==='AbortError')note('chat',e.queueCancelled?e.message:'生成を停止しました。');else note('chat',e.message,true);if(reply&&!answer)reply.textContent='返答を作成できませんでした。';}
 finally{if(answer&&!ui.revoked){ui.history.push({role:'user',content:text},{role:'assistant',content:answer});ui.lastReply=answer;}await GpuQueue.release(succeeded);ui.abort=null;ui.busy=null;controls();await refresh();}
});
$('editImage').addEventListener('change',()=>{
 if(ui.busy||ui.revoked)return;const selected=$('editImage').files[0];ui.file=null;if(ui.preview)URL.revokeObjectURL(ui.preview);ui.preview=null;$('editPreview').hidden=true;$('editPreview').removeAttribute('src');$('editUploadLabel').textContent='＋ 編集したい画像を選ぶ（任意）';
 if(selected){if(!['image/png','image/jpeg','image/webp'].includes(selected.type))note('edit','PNG・JPEG・WebPの画像を選んでください。',true);else if(selected.size>20*1024*1024)note('edit','画像は20MB以下で選んでください。',true);else{ui.file=selected;ui.preview=URL.createObjectURL(selected);$('editPreview').src=ui.preview;$('editPreview').hidden=false;$('editUploadLabel').textContent=selected.name;note('edit','変更したい内容と、残したい部分を入力してください。');}}controls();
});
$('clearEditImage').addEventListener('click',()=>{if(ui.busy)return;ui.file=null;if(ui.preview)URL.revokeObjectURL(ui.preview);ui.preview=null;$('editImage').value='';$('editPreview').hidden=true;$('editPreview').removeAttribute('src');$('editUploadLabel').textContent='＋ 編集したい画像を選ぶ（任意）';note('edit','元画像を外しました。説明文から新しい画像を生成できます。');controls();});
document.querySelectorAll('[data-reset]').forEach(button=>button.addEventListener('click',()=>{if(ui.busy)return;const mode=button.dataset.reset;$(mode+'Resolution').value=mode==='edit'?'768':'1024';$(mode+'Steps').value=25;$(mode+'Cfg').value=3;$(mode+'Negative').value=NEG[mode];if(mode==='generate')$('generateRatio').value='1';note(mode,'設定を初期値に戻しました。入力内容はそのままです。');}));
function socketConnect() { /* Encrypted HTTP polling supplies image completion. */ }
async function imageFailure(error){if(!ui.imageJob)return;const mode=ui.imageJob.mode;ui.imageJob=null;await GpuQueue.release();ui.busy=null;$(mode+'Progress').hidden=true;note(mode,error,true);ui.ws?.close();controls();}
async function imageHistory(){
 const job=ui.imageJob;if(!job)return;const result=await api('/api/private/jobs/'+job.id);
 if(['failed','expired'].includes(result.state)){await imageFailure(result.error||'画像処理に失敗しました。');return;}
 if(result.state==='completed'){ui.imageJob=null;ui.ws?.close();try{const shown=await PrivateImages.show(result.file,job.mode);note(job.mode,shown?'できました。画像は2分間表示されます。残したい場合は「画像を保存」を押してください。':'画像の準備ができました。結果の「この画像を開く」から表示できます。');await PrivateImages.archive();}catch(e){note(job.mode,e.message,true);}finally{await GpuQueue.release(true);ui.busy=null;$(job.mode+'Progress').hidden=true;controls();}}
}
async function runImage(mode){
 const prompt=$(mode+'Prompt').value.trim();if(!prompt||ui.busy||ui.revoked)return;const operation=mode==='edit'&&ui.file?'edit':'generate';ui.busy=mode;controls();const progress=$(mode+'Progress');progress.hidden=false;progress.removeAttribute('value');
 try{
  note(mode,'受付後は順番が来ると自動で始まります。');await GpuQueue.acquire('noctq');await PrivateImages.prepare();await ensureModel('noctq',mode);note(mode,operation==='edit'?'参照画像を一時メモリへ送信しています…':'画像を表示する準備をしています…');
  socketConnect();const result=await PrivateImages.submit(operation,{prompt,negative:$(mode+'Negative').value,resolution:Number($(mode+'Resolution').value),ratio:mode==='generate'?Number($('generateRatio').value):1,steps:Number($(mode+'Steps').value),cfg:Number($(mode+'Cfg').value),file:operation==='edit'?ui.file:null,clientId});
  if(ui.revoked)return;
  ui.imageJob={id:result.id,promptId:result.promptId,mode,operation};note(mode,(operation==='edit'?'編集':'画像生成')+'を開始しました。結果は暗号化し、メモリだけで受け渡します。');
 }catch(e){ui.imageJob=null;await GpuQueue.release();ui.busy=null;progress.hidden=true;note(mode,e.message,!e.queueCancelled);ui.ws?.close();controls();}
}
$('runGenerate').addEventListener('click',()=>runImage('generate'));$('runEdit').addEventListener('click',()=>runImage('edit'));
window.addEventListener('privacyready',controls);window.addEventListener('queuechange',controls);window.addEventListener('showprivateresult',event=>{if(ui.revoked)return;selectTab(event.detail.mode);if(event.detail.reveal)requestAnimationFrame(()=>$(event.detail.mode+'Output').scrollIntoView({behavior:'smooth',block:'nearest'}));});
$('openAdrenalin').addEventListener('click',async()=>{const b=$('openAdrenalin');b.disabled=true;try{await freshStatus();const r=await api('/api/tools/adrenalin',{method:'POST'});$('adrenalinStatus').textContent=r.message;}catch(e){$('adrenalinStatus').textContent=e.message;}finally{b.disabled=false;}});
GpuQueue.init({api,clientId});refresh();PrivateImages.init({api});statusTimer=setInterval(refresh,10000);controls();

window.addEventListener('pagehide',()=>revokeAccess({status:404,message:'この画面の利用を終了しました。'}));



