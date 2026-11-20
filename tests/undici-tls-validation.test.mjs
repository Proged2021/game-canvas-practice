import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:https';
import {once} from 'node:events';
import {Agent,fetch} from 'undici';

test('Agent preserves custom TLS rejection while explicit test-CA requests still work',async()=>{
  const cert=await readFile(new URL('./fixtures/test-only-tls/localhost-cert.pem',import.meta.url));
  const key=await readFile(new URL('./fixtures/test-only-tls/localhost-key.pem',import.meta.url));
  const server=createServer({cert,key},(_request,response)=>response.end('synthetic-localhost-response'));
  const agents=[];
  let checks=0;
  try{
    server.listen(0,'127.0.0.1');
    await once(server,'listening');
    const url=`https://127.0.0.1:${server.address().port}/`;
    const normal=new Agent({tls:{ca:cert}});agents.push(normal);
    assert.equal(await (await fetch(url,{dispatcher:normal})).text(),'synthetic-localhost-response');
    const rejecting=new Agent({tls:{ca:cert,checkServerIdentity(){
      checks++;
      return Object.assign(new Error('Synthetic certificate pin rejected'),{code:'SYNTHETIC_PIN_REJECTED'});
    }}});agents.push(rejecting);
    await assert.rejects(fetch(url,{dispatcher:rejecting}),error=>error.cause?.code==='SYNTHETIC_PIN_REJECTED');
    assert.ok(checks>0,'the caller verification callback actually ran');
    const untrusted=new Agent();agents.push(untrusted);
    await assert.rejects(fetch(url,{dispatcher:untrusted}),error=>['DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN'].includes(error.cause?.code));
  }finally{
    await Promise.all(agents.map(agent=>agent.destroy()));
    server.closeAllConnections();
    if(server.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});
