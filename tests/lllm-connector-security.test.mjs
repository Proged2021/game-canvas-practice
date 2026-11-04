import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setImmediate as settle } from 'node:timers/promises';
const require=createRequire(import.meta.url);
const __dirname=fileURLToPath(new URL('.',import.meta.url));
const connectorPath=fileURLToPath(new URL('../server/lllm-connector.cjs',import.meta.url));
const {invoke,allowed}=require(connectorPath).testHelpers;
const packet=()=>({method:'GET',path:'/api/status',headers:{authorization:'must-not-forward',cookie:'must-not-forward'},body:''});
const context=dispatch=>({getToken:()=> 'synthetic-control-token',markRequest(){},dispatch});

test('an already revoked relay request never reaches dispatch or reads its control token',async()=>{
 const controller=new AbortController();controller.abort();let dispatched=0,tokens=0;
 await assert.rejects(invoke(packet(),'synthetic-account',crypto.randomUUID(),{...context((_req,res)=>{dispatched++;res.end('{}');}),getToken(){tokens++;return 'synthetic';}},controller.signal),/Cancelled|aborted/i);
 assert.equal(dispatched,0);assert.equal(tokens,0);
});

test('revocation in the dispatch microtask gap cannot start a server action',async()=>{
 const controller=new AbortController();let dispatched=0;
 const pending=invoke({method:'POST',path:'/api/action',headers:{},body:Buffer.from('{"action":"start","model":"synthetic"}').toString('base64')},'synthetic-account',crypto.randomUUID(),context((_req,res)=>{dispatched++;res.end('{}');}),controller.signal);
 controller.abort();await assert.rejects(pending,/Cancelled|aborted/i);await settle();assert.equal(dispatched,0);
});

test('a successful response completed during revocation is not returned to the caller',async()=>{
 const controller=new AbortController();
 await assert.rejects(invoke(packet(),'synthetic-account',crypto.randomUUID(),context((_req,res)=>{res.end('{}');controller.abort();}),controller.signal),/Cancelled|aborted/i);
});

test('an authorized response preserves the route allowlist and strips backend secrets',async()=>{
 const controller=new AbortController();
 const result=await invoke(packet(),'synthetic-account',crypto.randomUUID(),context((req,res)=>{
  assert.equal(req.headers.authorization,undefined);assert.equal(req.headers.cookie,undefined);
  assert.equal(req.headers['x-control-token'],'synthetic-control-token');assert.equal(req.socket.remoteAddress,'workspace:synthetic-account');
  res.writeHead(200,{'content-type':'application/json','set-cookie':'must-not-return'});
  res.end(JSON.stringify({models:[],memory:{},actionToken:'must-not-return',meshIp:'must-not-return'}));
 }),controller.signal);
 const value=JSON.parse(Buffer.from(result.body,'base64'));
 assert.equal(value.actionToken,'workspace');assert.equal(value.meshIp,undefined);assert.equal(result.headers['set-cookie'],undefined);
 for(const candidate of ['/api/tools/adrenalin','/api/private/keys','/internal/private/result/anything','/api/status?bypass=1','https://other.invalid/api/status'])assert.equal(allowed('POST',candidate)||allowed('GET',candidate),false);
});

function startup({unsafeTls=false}={}){
 const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
 let reads=0,fetchOptions,resolveFetch;
 const fetched=new Promise(resolve=>{resolveFetch=resolve;});
 const config={origin:'https://game-canvas.app',privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}),token:'synthetic-connector-secret'};
 const module={exports:{}};
 const sandbox={module,exports:module.exports,Buffer,URL,AbortSignal,AbortController,console:{error(){}},
  process:{env:unsafeTls?{NODE_TLS_REJECT_UNAUTHORIZED:'0'}:{}},
  setTimeout,clearTimeout,fetch:async(_url,options)=>{fetchOptions=options;resolveFetch();throw Error('Synthetic no-network boundary');},
  require(name){if(name==='node:fs')return {existsSync(){reads++;return true;}};
   if(name==='node:child_process')return {spawnSync(){reads++;return {status:0,stdout:JSON.stringify(config)};}};
   return require(name);},
 };
 vm.runInNewContext(fs.readFileSync(connectorPath,'utf8'),sandbox);
 const relay=module.exports({root:path.join(__dirname,'synthetic-config'),...context(()=>{throw Error('Must not dispatch');})});
 return {relay,fetched,getOptions:()=>fetchOptions,getReads:()=>reads};
}

test('disabled TLS verification fails closed before opening connector identity or making a request',async()=>{
 const f=startup({unsafeTls:true});await settle();
 try{assert.equal(f.getReads(),0);assert.equal(f.getOptions(),undefined);}finally{f.relay.close();}
});

test('the authenticated HTTPS relay explicitly refuses redirects',async()=>{
 const f=startup();
 try{await f.fetched;assert.equal(f.getOptions().redirect,'error');assert.equal(f.getOptions().cache,'no-store');}finally{f.relay.close();}
});

test('archive query permits only one literal recipient identifier on the read-only files route',async()=>{
 const recipient='a'.repeat(64),route='/api/private/files?recipient='+recipient;
 assert.equal(allowed('GET',route),true);assert.equal(allowed('POST',route),false);
 for(const candidate of [route+'&recipient='+recipient,route+'&account=other',route+'#fragment',route.replace('recipient=','recipient=%'),'/api/private/files?recipient=../secret','/api/private/files?recipient=','/api/private/files?recipient='+recipient.toUpperCase(),null,{},'/api/private/jobs?recipient='+recipient])assert.equal(allowed('GET',candidate),false);
 let dispatched=false;
 const result=await invoke({method:'GET',path:route,headers:{},body:''},'synthetic-account',crypto.randomUUID(),context((req,res)=>{dispatched=true;assert.equal(req.url,route);assert.equal(req.socket.remoteAddress,'workspace:synthetic-account');res.end('{"files":[]}');}),new AbortController().signal);
 assert.equal(dispatched,true);assert.deepEqual(JSON.parse(Buffer.from(result.body,'base64')),{files:[]});
});
