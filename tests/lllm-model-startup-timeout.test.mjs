import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../lllm/studio.js',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('function modelOperationBudgetMs('),source.indexOf('\nfunction note('));
const ensure=source.slice(source.indexOf('async function ensureModel('),source.indexOf('\nasync function refresh('));
const manual=source.slice(source.indexOf("$('models').addEventListener('click'"),source.indexOf("\n$('newChat').addEventListener"));

for(const model of ['noctq','qwen25']) test(`automatic ${model} startup can complete after eight minutes`,async()=>{
 let now=0,reads=0;
 const context=vm.createContext({Date:{now:()=>now},freshStatus:async()=>++reads===1?{job:{label:'Starting'}}:{job:null,imageRunning:true,current:model},nap:async()=>{now+=8*60000;},note:()=>{},api:async()=>{throw Error('must not start a duplicate job');}});
 vm.runInContext(helper+'\n'+ensure+'\nglobalThis.run=ensureModel;',context);
 await context.run(model,'generate');assert.equal(reads,2);
});

test('automatic startup remains bounded when the controller never becomes ready',async()=>{
 let now=0,reads=0;
 const context=vm.createContext({Date:{now:()=>now},freshStatus:async()=>{reads++;return {job:{label:'Starting'}};},nap:async()=>{now+=47*60000;},note:()=>{}});
 vm.runInContext(helper+'\n'+ensure+'\nglobalThis.run=ensureModel;',context);
 await assert.rejects(context.run('noctq','generate'),/モデルの準備に時間/);assert.equal(reads,1);
});

async function manualOperation(action){
 let handler,now=0,reads=0,calls=0;const released=[],notice={textContent:''},ui={busy:null,revoked:false,server:null};
 const context=vm.createContext({Date:{now:()=>now},ui,controls:()=>{},refresh:async()=>{},
  $:id=>id==='models'?{addEventListener:(_name,fn)=>{handler=fn;}}:notice,
  GpuQueue:{acquire:async()=>{},release:async ok=>released.push(ok)},
  api:async()=>{calls++;return {code:202,message:'Starting',job:{id:'owned-job'}};},
  freshStatus:async()=>{reads++;const state=reads<3?{job:{id:'owned-job'}}:{job:null,lastJob:{id:'owned-job',ok:true}};ui.server=state;return state;},
  nap:async()=>{now+=8*60000;},
 });
 vm.runInContext(helper+'\n'+manual,context);
 await handler({target:{closest:()=>({dataset:{model:'noctq',action}})}});
 return {released,calls,notice,ui};
}
test('manual model startup also waits past the old seven-minute limit',async()=>{
 const r=await manualOperation('start');assert.deepEqual(r.released,[true]);assert.equal(r.calls,1);assert.equal(r.ui.busy,null);
});
test('manual stop keeps its shorter bounded wait',async()=>{
 const r=await manualOperation('stop');assert.deepEqual(r.released,[false]);assert.equal(r.calls,1);assert.match(r.notice.textContent,/状態を確認中/);
});
