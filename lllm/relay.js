/* No persistent browser storage. Every request is sealed for the user's server. */
(() => {
  'use strict';
  const nativeFetch = window.fetch.bind(window);
  const slug = document.querySelector('meta[name="lllm-workspace"]').content;
  const endpoint = '/api/workspaces/' + encodeURIComponent(slug) + '/extensions/lllm';
  const pending = new Set();
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const size = 180000;
  const b64 = bytes => { let s=''; for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c=>c.charCodeAt(0));
  const concat = (...arrays) => {const a=new Uint8Array(arrays.reduce((n,v)=>n+v.length,0));let i=0;for(const v of arrays){a.set(v,i);i+=v.length;}return a;};
  const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
  let revoked=null;
  function accessError(){const error=Error(revoked?.message||'LLLMの利用権限を確認できません。ワークスペースへ戻って確認してください。');error.status=revoked?.status||403;error.code=revoked?.code||'LLLM_ACCESS_REVOKED';return error;}
  function revoke(error){
    if(revoked)return;
    revoked={status:error.status,code:error.code,message:error.message};publicKey=null;
    for(const id of pending)cancelJob(id);
    window.dispatchEvent(new CustomEvent('lllmaccessrevoked',{detail:{...revoked}}));
  }
  async function json(query,body,signal) {
    if(revoked)throw accessError();
    const r=await nativeFetch(endpoint+query,{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',signal,
      headers:body?{'Content-Type':'application/json','X-Plotline-Csrf':'lllm-relay'}:{},body:body?JSON.stringify(body):undefined});
    const result=await r.json().catch(()=>({}));
    if(!r.ok){
      const error=Error(result.error||'LLLMとの通信に失敗しました');error.status=r.status;error.code=result.code||'LLLM_HTTP_'+r.status;
      if([401,403,404].includes(r.status)){
        if(!query&&!body)revoke(error);
        // A missing job may only have expired. Confirm access independently.
        else await json('',null,signal).catch(()=>{});
      }
      throw error;
    }
    if(revoked)throw accessError();
    return result;
  }
  let publicKey;
  const getKey=async()=>publicKey||(publicKey=crypto.subtle.importKey('spki',unb64((await json('')).publicKey),{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']));
  async function relay(input, options={}) {
    const url=new URL(typeof input==='string'?input:input.url,location.origin);
    if(url.origin!==location.origin||!/^\/api\/(?:status|action|chat|queue|private)(?:\/|$)/.test(url.pathname))return nativeFetch(input,options);
    if(revoked)throw accessError();
    const signal=options.signal;if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    const id=crypto.randomUUID(),rawKey=crypto.getRandomValues(new Uint8Array(32));
    let rawBody,plain,wire,key;
    pending.add(id);
    const cancel=()=>cancelJob(id);
    signal?.addEventListener('abort',cancel,{once:true});
    try {
      key=await crypto.subtle.importKey('raw',rawKey,'AES-GCM',false,['encrypt','decrypt']);
      const wrapped=new Uint8Array(await crypto.subtle.encrypt('RSA-OAEP',await getKey(),rawKey));rawKey.fill(0);
      const headers=Object.fromEntries(new Headers(options.headers||{}));
      if(options.body instanceof Blob)rawBody=new Uint8Array(await options.body.arrayBuffer());
      else if(options.body instanceof ArrayBuffer||ArrayBuffer.isView(options.body))rawBody=new Uint8Array(options.body.buffer||options.body,options.body.byteOffset||0,options.body.byteLength);
      else rawBody=encoder.encode(options.body||'');
      if(rawBody.byteLength>21*1024*1024)throw Error('送信データが大きすぎます');
      plain=encoder.encode(JSON.stringify({path:url.pathname+url.search,method:options.method||'GET',headers,body:b64(rawBody)}));
      const iv=crypto.getRandomValues(new Uint8Array(12));
      const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('lllm-v1:req:'+id)},key,plain));plain.fill(0);plain=null;
      wire=concat(wrapped,iv,encrypted);const encoded=b64(wire);wire.fill(0);wire=null;
      const parts=Math.ceil(encoded.length/size);await json('',{action:'create',id,parts},signal);
      for(let p=0;p<parts;p++)await json('',{action:'chunk',id,part:p,ciphertext:encoded.slice(p*size,(p+1)*size)},signal);
      await json('',{action:'submit',id},signal);
      const deadline=Date.now()+20*60*1000;
      let state;
      while(Date.now()<deadline){if(signal?.aborted)throw new DOMException('Cancelled','AbortError');state=await json('?id='+id,null,signal);if(state.state==='done')break;if(state.state==='failed')throw Error('サーバー側の処理が中断されました。状態を確認してから再実行してください');await pause(900);}
      if(state?.state!=='done')throw Error('LLLMとの通信がタイムアウトしました');
      const chunks=[];for(let p=0;p<state.response_parts;p++)chunks.push((await json('?id='+id+'&part='+p,null,signal)).ciphertext);
      wire=unb64(chunks.join(''));
      plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:wire.subarray(0,12),additionalData:encoder.encode('lllm-v1:res:'+id)},key,wire.subarray(12)));
      const packet=JSON.parse(decoder.decode(plain));plain.fill(0);plain=null;wire.fill(0);wire=null;
      const result=unb64(packet.body);
      if(revoked){result.fill(0);throw accessError();}
      return new Response(result,{status:packet.status,headers:{...packet.headers,'cache-control':'no-store'}});
    } finally {
      rawKey.fill(0);plain?.fill(0);wire?.fill(0);
      // Blob/typed-array inputs belong to the caller; wipe only our own copy.
      if(typeof options.body==='string'||options.body instanceof Blob||!options.body)rawBody?.fill(0);
      key=null;pending.delete(id);signal?.removeEventListener('abort',cancel);cancel();
    }
  }
  window.fetch=relay;
  window.addEventListener('pagehide',()=>{for(const id of pending)cancelJob(id);publicKey=null;});
  function cancelJob(id){void nativeFetch(endpoint,{method:'POST',keepalive:true,cache:'no-store',headers:{'Content-Type':'application/json','X-Plotline-Csrf':'lllm-relay'},body:JSON.stringify({action:'delete',id})}).catch(()=>{});}
  // Back/forward cache must never resurrect conversation contents or keys.
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
})();
