window.GpuQueue=(()=>{
 let api,clientId,own=null,globalState=null,cancelled=false,timer=null,renewing=false,revision=0;
 const $=id=>document.getElementById(id),names={gemma:'Gemma 4',qwen:'Qwen 3.8',qwen25:'Qwen2.5',noctq:'画像AI'};
 function render(){
  const waiting=own?.state==='queued',running=own?.state==='granted',paused=globalState?.paused||own?.paused,shared=globalState?.active||globalState?.waiting;
  $('queuePanel').hidden=!waiting&&!running&&!shared&&!paused;$('cancelWaiting').hidden=!waiting;$('cancelWaiting').disabled=cancelled;
  $('queueTitle').textContent=paused?'PCの作業を優先して一時停止中':waiting?'順番を待っています':running?'あなたの番です':'みんなで順番に利用中';
  $('queueMessage').textContent=paused?(globalState?.pauseMessage||own?.pauseMessage||'負荷が落ち着いたら受付を再開します。')+(waiting?' 待ち順は'+own.position+'番目です。ページを開いたままお待ちください。':''):waiting?'現在の待ち順：'+own.position+'番目 · 前に'+own.ahead+'件'+(own.estimatedWaitSeconds!==null?' · 目安 約'+Math.max(1,Math.ceil(own.estimatedWaitSeconds/60))+'分':'')+'。このまま開いておくと、自動で始まります。':running?(names[own.model]||'AI')+'を準備・実行しています。':(globalState?.active?(names[globalState.active.model]||'AI')+'を実行中。':'')+' 送信すると順番待ちに入ります。待機 '+(globalState?.waiting||0)+'件。';window.dispatchEvent(new Event('queuechange'));
 }
 async function heartbeat(){if(!own)return;const current=own.id,generation=revision,next=await api('/api/queue/tickets/'+current+'/heartbeat',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(generation!==revision||own?.id!==current)return own;own=next;render();return next;}
 async function release(completed=false){
  revision++;clearInterval(timer);timer=null;const previous=own;own=null;render();if(!previous)return;
  await api('/api/queue/tickets/'+previous.id+'/release',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({completed})}).catch(()=>{});
 }
 function abortError(){const e=Error('順番待ちをキャンセルしました。');e.name='AbortError';e.queueCancelled=true;return e;}
 async function acquire(model){
  if(own)throw Error('この画面の先の処理を終えてから実行してください。');cancelled=false;const generation=++revision;
  const received=await api('/api/queue/tickets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,clientId})});if(generation!==revision){await api('/api/queue/tickets/'+received.id+'/release',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});throw abortError();}own=received;render();if(own.state==='queued')requestAnimationFrame(()=>$('queuePanel').scrollIntoView({behavior:'smooth',block:'nearest'}));
  while(own?.state==='queued'){
   if(generation!==revision)throw abortError();if(cancelled){await release();throw abortError();}await new Promise(resolve=>setTimeout(resolve,1500));if(generation!==revision)throw abortError();if(cancelled){await release();throw abortError();}await heartbeat();
  }
  if(generation!==revision)throw abortError();if(cancelled){await release();throw abortError();}
  if(own?.state!=='granted'){const message=own?.error||'順番待ちの接続が切れました。もう一度送信してください。';await release();throw Error(message);}
  timer=setInterval(async()=>{if(renewing||!own)return;renewing=true;try{await heartbeat();}catch{}finally{renewing=false;}},5000);return own.id;
 }
 function init(options){api=options.api;clientId=options.clientId;$('cancelWaiting').onclick=()=>{cancelled=true;if(own)api('/api/queue/tickets/'+own.id+'/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});};window.addEventListener('pagehide',()=>release());}
 return {init,acquire,release,ticket:()=>own?.state==='granted'?own.id:null,view:()=>own?{state:own.state,position:own.position,ahead:own.ahead}:null,isWaiting:()=>own?.state==='queued',update:s=>{globalState=s;render();}};
})();
