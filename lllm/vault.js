window.PrivateImages=(()=>{
 const $=id=>document.getElementById(id);
 let api,info=null,key=null,session=null,working=false,epoch=0,revoked=false;
 const pending=new Map(),displayUrls=new Map(),displayTimers=new Map(),downloads=[],downloadTimers=new Map();let viewer=null;
 const note=(text,error=false)=>{if(revoked)return;$('vaultStatus').textContent=text;$('vaultStatus').className='notice'+(error?' error':'');};
 function fileNote(text,error=false){if(revoked)return;$('imageOpenStatus').textContent=text;$('imageOpenStatus').className='notice'+(error?' error':'');}
 function clearDisplay(mode){
  const clock=displayTimers.get(mode);if(clock){clearTimeout(clock.timeout);clearInterval(clock.interval);}displayTimers.delete(mode);$(mode+'Expiry').hidden=true;
  const old=displayUrls.get(mode);if(old)URL.revokeObjectURL(old);displayUrls.delete(mode);
  $(mode+'Output').removeAttribute('src');$(mode+'Output').hidden=true;$(mode+'Empty').hidden=false;
  $(mode+'Download').hidden=true;$(mode+'Download').removeAttribute('href');$(mode+'UnlockResult').hidden=true;
  $(mode+'EncryptedDownload').removeAttribute('href');
 }
 function armExpiry(mode,result){
  const clock={deadline:Date.now()+120000};displayTimers.set(mode,clock);
  function tick(){if(displayTimers.get(mode)!==clock)return;const remaining=Math.ceil((clock.deadline-Date.now())/1000);if(remaining<=0){clearDisplay(mode);$(mode+'Expiry').hidden=false;$(mode+'Expiry').textContent='2分が経過したため画像を閉じました。';return;}$(mode+'Expiry').hidden=false;$(mode+'Expiry').textContent='表示終了まで '+Math.floor(remaining/60)+':'+String(remaining%60).padStart(2,'0');}
  clock.interval=setInterval(tick,1000);clock.timeout=setTimeout(()=>{if(displayTimers.get(mode)===clock){clearDisplay(mode);$(mode+'Expiry').hidden=false;$(mode+'Expiry').textContent='2分が経過したため画像を閉じました。';}},120000);tick();
  if(result.viewProof)api('/api/private/files/'+result.header.id+'/viewed',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({proof:result.viewProof})}).catch(()=>{});
 }
 function checkExpiry(){for(const[mode,clock]of displayTimers){if(clock.deadline<=Date.now()){clearDisplay(mode);$(mode+'Expiry').hidden=false;$(mode+'Expiry').textContent='2分が経過したため画像を閉じました。';}else $(mode+'Output').hidden=!!document.hidden;}}
 function clearViewer(){if(viewer?.bytes)viewer.bytes.fill(0);viewer=null;$('encryptedImageFile').value='';$('keyFile').value='';$('keyUnlockPassword').value='';$('imageOpenPanel').hidden=true;}
 function lock(){
  if(session)api('/api/private/session/release',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({id:session.id})}).catch(()=>{});
  epoch++;key?.secret.fill(0);session?.secret.fill(0);key=session=null;pending.clear();
  for(const url of downloads)URL.revokeObjectURL(url);downloads.length=0;
  for(const timer of downloadTimers.values())clearTimeout(timer);downloadTimers.clear();
  for(const mode of ['generate','edit'])clearDisplay(mode);clearViewer();render();
 }
 function clear(){
  if(revoked)return;revoked=true;info=null;working=false;lock();
  $('vaultFiles').replaceChildren();$('vaultRecipient').replaceChildren();
  for(const id of ['keyLabel','keyPassword','keyPasswordConfirm','keyUnlockPassword'])$(id).value='';
  for(const id of ['keyCreate','keyUnlock','encryptedImageFile','keyFile','keyUnlockPassword','imageTarget','vaultRecipient','openSavedImage'])$(id).disabled=true;
  $('keyLock').hidden=true;$('imageOpenPanel').hidden=true;$('vaultStatus').textContent='利用権限を確認できないため、画像と一時鍵を閉じました。';
  window.dispatchEvent(new Event('privacyready'));
 }
 function target(){return info?.canUnlock&&$('imageTarget').value!=='other'?'this':'other';}
 function render(){
  if(revoked||!info)return;const selected=$('vaultRecipient').value;
  $('keyControls').hidden=!info.canUnlock;$('openSavedImage').hidden=!info.canUnlock;$('localKeyNotice').hidden=info.canUnlock;
  $('imageTarget').disabled=!info.canUnlock||working;
  if(!info.canUnlock){$('imageTarget').value='other';$('imageSecurityDetails').open=true;}
  $('recipientControls').hidden=target()!=='other';
  $('imagePrivacyTitle').textContent=target()==='this'?'生成した画像を、この画面に表示':'画像を、選んだ端末へ送る';
  $('imagePrivacyHint').textContent=target()==='this'?'生成した画像は、この画面に2分間だけ表示します。残り時間も表示されます。残したい場合は、時間内に「画像を保存」を押してください。':'画像は暗号化して送ります。表示は2分間です。送信先の鍵で開いてください。';
  $('keyState').textContent=working?'準備中…':session||key?'この端末で表示できます':'暗号化して受け渡し';
  $('keyLock').hidden=!key&&!session;$('vaultRecipient').replaceChildren();
  for(const r of info.recipients){const option=document.createElement('option');option.value=r.id;option.textContent=r.label;$('vaultRecipient').append(option);}
  if(info.recipients.some(r=>r.id===selected))$('vaultRecipient').value=selected;
  $('vaultRecipient').disabled=!info.recipients.length||working;
  for(const id of ['keyCreate','keyUnlock','encryptedImageFile','keyFile','keyUnlockPassword'])$(id).disabled=working;
  window.dispatchEvent(new Event('privacyready'));
 }
 async function status(){if(revoked)return;const start=epoch,next=await api('/api/private/status');if(revoked||start!==epoch)return;info=next;render();}
 async function prepare(){
  if(revoked)throw Error('LLLMの利用権限を確認できません。ワークスペースへ戻って確認してください。');
  if(!info)await status();
  if(revoked)throw Error('LLLMの利用権限を確認できません。ワークスペースへ戻って確認してください。');
  if(target()==='other'){
   if(!$('vaultRecipient').value)throw Error('「別の端末へ送る・その他の設定」で、画像の送信先を選んでください。');return $('vaultRecipient').value;
  }
  const start=epoch;if(!session)session=StudioCrypto.createSessionKey();const current=session;
  await api('/api/private/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({publicKey:StudioCrypto.base64(current.pub)})});
  if(start!==epoch||session!==current)throw Error('画像の表示を閉じました。もう一度生成してください。');render();return current.id;
 }
 async function create(){
  if(working||!info?.canUnlock)return;const password=$('keyPassword').value;
  if(password!==$('keyPasswordConfirm').value)return note('合言葉が一致しません。',true);
  working=true;render();let next;const start=epoch;
  try{
   next=await StudioCrypto.createKey(password);if(start!==epoch){next.secret.fill(0);return;}
   await api('/api/private/keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({publicKey:StudioCrypto.base64(next.pub),label:$('keyLabel').value.trim()||'私の端末'})});
   if(start!==epoch){next.secret.fill(0);return;}
   const url=URL.createObjectURL(new Blob([next.file],{type:'application/json'}));downloads.push(url);const link=document.createElement('a');link.href=url;link.download='AI-Studio-'+next.id.slice(0,8)+'.aikey';link.click();
   key?.secret.fill(0);key=next;$('keyPassword').value='';$('keyPasswordConfirm').value='';$('keyCreateDetails').open=false;await status();
   note('この端末用の鍵ファイルを保存しました。別端末からこの端末へ送るときに使えます。');
  }catch(e){if(next&&next!==key)next.secret.fill(0);note(e.message,true);}finally{working=false;render();}
 }
 function envelopeHeader(bytes){
  if(bytes.length<100||new TextDecoder().decode(bytes.subarray(0,8))!=='AISTIMG1')throw Error('AI Studioで保存した暗号化画像を選んでください。');
  const size=new DataView(bytes.buffer,bytes.byteOffset+8,4).getUint32(0);
  if(size>4096||12+size+16>bytes.length)throw Error('画像ファイルが破損しています。');
  const header=JSON.parse(new TextDecoder().decode(bytes.subarray(12,12+size)));
  if(header.version!==1||header.algorithm!=='X25519-HKDF-SHA256-AES-256-GCM'||header.mime!=='image/png'||!/^[a-f0-9]{64}$/.test(header.recipient))throw Error('画像ファイルの形式を確認できません。');return header;
 }
 function matchingKey(bytes){const header=envelopeHeader(bytes);return [session,key].find(k=>k?.id===header.recipient);}
 function displayEncrypted(bytes,mode){
  if(!info?.canUnlock)throw Error('画像の表示は外部端末で行ってください。');const chosen=matchingKey(bytes);if(!chosen)return false;
  const result=StudioCrypto.decryptEnvelope(bytes,chosen);
  try{
   if(![137,80,78,71,13,10,26,10].every((n,i)=>result.plain[i]===n))throw Error('復号したデータがPNG画像ではありません。');
   mode=mode||(['generate','edit'].includes(result.header.mode)?result.header.mode:'generate');clearDisplay(mode);
   const url=URL.createObjectURL(new Blob([result.plain],{type:'image/png'}));displayUrls.set(mode,url);
   const id=/^[a-f0-9-]{36}$/i.test(result.header.id)?result.header.id:'AI-Studio';
   $(mode+'Output').src=url;$(mode+'Output').hidden=false;$(mode+'Empty').hidden=true;
   $(mode+'Download').href=url;$(mode+'Download').download=id+'.png';$(mode+'Download').textContent='画像を保存';$(mode+'Download').hidden=false;
   armExpiry(mode,result);pending.delete(mode);window.dispatchEvent(new CustomEvent('showprivateresult',{detail:{mode,reveal:true}}));return true;
  }finally{result.plain.fill(0);}
 }
 function offerKey(){
  $('imageOpenStep').textContent='あと1つ：この画像の鍵を選んでください';$('savedImageKeyStep').hidden=false;
  fileNote('画像を作ったときに保存した鍵ファイル（.aikey）と合言葉が必要です。新しい鍵を作っても、この画像は開けません。');
 }
 async function openViewer(source){
  if(!info?.canUnlock)return;clearViewer();viewer={bytes:null,mode:source?.mode};$('imageOpenPanel').hidden=false;
  $('savedImageKeyStep').hidden=true;$('imageFileStep').hidden=!!source;$('imageOpenStep').textContent='① 保存した画像を選ぶ';fileNote('画像を選ぶと、そのまま表示します。鍵が必要な場合だけ、次の手順を案内します。');
  if(source){
   const start=epoch,current=viewer;
   try{const response=await fetch(source.file,{cache:'no-store'});if(!response.ok)throw Error('保管期限が切れました。ダウンロード済みの画像を選んでください。');const bytes=new Uint8Array(await response.arrayBuffer());if(start!==epoch||viewer!==current){bytes.fill(0);return;}viewer.bytes=bytes;if(displayEncrypted(bytes,viewer.mode))clearViewer();else offerKey();}
   catch(e){$('imageFileStep').hidden=false;fileNote(e.message,true);}
  }
 }
 async function openSaved(){
  if(working||!info?.canUnlock)return;const file=$('encryptedImageFile').files[0];
  if(!file)return fileNote('「保存した画像を選ぶ」を押して、.aistudioファイルを選んでください。',true);
  if(file.size>41*1024*1024)return fileNote('画像ファイルは41MB以下で選んでください。',true);
  if(viewer?.bytes)viewer.bytes.fill(0);viewer={bytes:null};$('imageOpenPanel').hidden=false;const current=viewer,start=epoch;working=true;render();let bytes;
  try{
   bytes=new Uint8Array(await file.arrayBuffer());if(start!==epoch||viewer!==current)return;
   envelopeHeader(bytes);viewer.bytes=bytes;bytes=null;
   if(displayEncrypted(viewer.bytes)){clearViewer();note('画像をこの画面に表示しました。「画像を保存」からPNGで保存できます。');}else offerKey();
  }catch(e){if(viewer?.bytes)viewer.bytes.fill(0);viewer=null;fileNote(e.message,true);}finally{bytes?.fill(0);working=false;render();}
 }
 async function unlock(){
  if(working||!info?.canUnlock)return;const file=$('keyFile').files[0];
  if(!file)return fileNote('②の「鍵ファイルを選ぶ」から、.aikeyファイルを選んでください。',true);
  if(file.size>8192)return fileNote('鍵ファイルが大きすぎます。',true);
  working=true;render();const start=epoch,current=viewer;let next;
  try{
   next=await StudioCrypto.unlockKey(await file.text(),$('keyUnlockPassword').value);if(start!==epoch||viewer!==current){next.secret.fill(0);return;}
   if(viewer?.bytes&&envelopeHeader(viewer.bytes).recipient!==next.id)throw Error('この画像とは別の鍵です。画像の送信先に対応する.aikeyを選んでください。');
   key?.secret.fill(0);key=next;$('keyUnlockPassword').value='';$('keyFile').value='';
   if(viewer?.bytes){displayEncrypted(viewer.bytes,viewer.mode);clearViewer();note('画像をこの画面に表示しました。「画像を保存」からPNGで保存できます。');}else{clearViewer();note('この端末で画像を表示できるようになりました。');}
   for(const [mode,url]of pending){try{await show(url,mode);}catch{}}
  }catch(e){if(next&&next!==key)next.secret.fill(0);fileNote(e.message,true);}finally{working=false;render();}
 }
 async function show(file,mode){
  if(revoked)return false;
  if(!['generate','edit'].includes(mode))throw Error('表示先が不正です。');pending.set(mode,file);clearDisplay(mode);
  if(info?.canUnlock&&(session||key)){
   const start=epoch,response=await fetch(file,{cache:'no-store'});if(!response.ok)throw Error('画像の保管期限が切れました。保存済みの画像は「保存した画像を開く」から表示できます。');
   const bytes=new Uint8Array(await response.arrayBuffer());try{if(start!==epoch)return false;if(displayEncrypted(bytes,mode))return true;}finally{bytes.fill(0);}
  }
  $(mode+'UnlockResult').hidden=false;$(mode+'ViewResult').hidden=!info?.canUnlock;
  $(mode+'ResultHint').textContent=info?.canUnlock?'画像の準備ができました。「この画像を開く」から、送信先の鍵を選ぶと表示できます。':'画像は暗号化して送信先へ届きます。表示は外部端末で行ってください。';
  const download=$(mode+'EncryptedDownload');download.href='#';download.onclick=event=>{event.preventDefault();return downloadEncrypted(file,download);};return false;
 }
 async function downloadEncrypted(file,button){
  if(revoked||button.disabled)return;const start=epoch;button.disabled=true;let bytes;
  try{
   // Native anchor navigation bypasses the authenticated, encrypted fetch relay.
   const response=await fetch(file,{cache:'no-store'});if(!response.ok)throw Error('保管期限が切れたため保存できません。');
   bytes=new Uint8Array(await response.arrayBuffer());if(revoked||start!==epoch)return;
   const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));downloads.push(url);
   const link=document.createElement('a');link.href=url;link.download=file.split('/').pop()+'.aistudio';link.click();
   downloadTimers.set(url,setTimeout(()=>{URL.revokeObjectURL(url);downloadTimers.delete(url);const index=downloads.indexOf(url);if(index>=0)downloads.splice(index,1);},60000));
  }catch(e){if(!revoked&&start===epoch)note(e.message,true);}finally{bytes?.fill(0);button.disabled=revoked;}
 }
 async function archive(){
  const recipient=$('vaultRecipient').value;if(revoked||!recipient)return;const start=epoch,data=await api('/api/private/files?recipient='+encodeURIComponent(recipient)),container=$('vaultFiles');if(revoked||start!==epoch)return;container.replaceChildren();
  if(!data.files.length){container.textContent='保管中の画像はありません。PC側の一時保管は10分です。';return;}
  for(const file of data.files){
   const row=document.createElement('div');row.className='vaultrow';const label=document.createElement('span');label.textContent=new Date(file.createdAt).toLocaleString('ja-JP')+' · '+(file.mode==='edit'?'編集':'生成');row.append(label);
   if(info.canUnlock){const button=document.createElement('button');button.className='secondary';button.textContent='画像を表示';button.onclick=()=>openViewer({file:'/api/private/files/'+file.id,mode:file.mode});row.append(button);}
   const download=document.createElement('button');download.className='secondary';download.type='button';download.textContent='暗号化したまま保存';download.onclick=()=>downloadEncrypted('/api/private/files/'+file.id,download);row.append(download);container.append(row);
  }
 }
 async function submit(mode,values){
  const recipient=await prepare();let reference=null;
  if(mode==='edit'){if(!info.canUnlock)throw Error('元画像は外部端末から選んでください。');reference=(await api('/api/private/reference',{method:'POST',headers:{'Content-Type':values.file.type},body:values.file})).id;}
  return api('/api/private/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...values,file:undefined,mode,recipient,reference})});
 }
 async function init(options){
  api=options.api;$('keyCreate').onclick=create;$('keyUnlock').onclick=unlock;$('keyLock').onclick=()=>{lock();note('画像と一時鍵を閉じました。次の生成時には新しい鍵を作ります。');};
  $('openSavedImage').onclick=()=>openViewer();$('closeImageOpen').onclick=clearViewer;$('encryptedImageFile').onchange=openSaved;
  $('keyUnlockPassword').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();unlock();}};
  $('imageTarget').onchange=()=>{render();note('');};$('vaultRecipient').onchange=()=>archive().catch(e=>note(e.message,true));
  for(const mode of ['generate','edit'])$(mode+'ViewResult').onclick=()=>{const file=pending.get(mode);if(file)openViewer({file,mode});};
  $('vaultArchive').addEventListener('toggle',()=>{if($('vaultArchive').open)archive().catch(e=>note(e.message,true));});
  document.addEventListener('visibilitychange',checkExpiry);window.addEventListener('focus',checkExpiry);window.addEventListener('pagehide',lock);window.addEventListener('lllmaccessrevoked',clear);try{await status();}catch(e){note(e.message,true);}
 }
 return {init,refresh:status,lock,clear,ready:()=>!revoked&&!!info&&(info.canUnlock||info.recipients.length>0),prepare,submit,show,archive,canUnlock:()=>!revoked&&!!info?.canUnlock};
})();
