import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID, generateKeyPairSync, webcrypto, publicEncrypt, randomBytes, createCipheriv, createHash } from 'node:crypto';
import vm from 'node:vm';
import { resolve } from 'node:path';
import { build } from 'esbuild';
const require=createRequire(import.meta.url);
const {allowed,openRequest,sealResponse,invoke}=require('../server/lllm-connector.cjs').testHelpers;
const W='0279e5f9-6122-4fb9-90ff-b9073a9fc7c1',origin='https://game-canvas.app';
const sqlite=new DatabaseSync(':memory:');
sqlite.exec(`PRAGMA foreign_keys=ON;CREATE TABLE workspaces(id TEXT PRIMARY KEY,slug TEXT,name TEXT,updated_at TEXT);CREATE TABLE account_memberships(workspace_id TEXT,account_key TEXT,role TEXT,PRIMARY KEY(workspace_id,account_key));
 INSERT INTO workspaces VALUES('${W}','minamomura','水面村','old');INSERT INTO workspaces VALUES('other','other','水無墓村','old');
 INSERT INTO account_memberships VALUES('${W}','alice','owner'),('${W}','bob','viewer'),('other','alice','owner');`);
sqlite.exec(await readFile(new URL('../drizzle/0014_workspace_lllm.sql',import.meta.url),'utf8'));
sqlite.exec(await readFile(new URL('../drizzle/0015_workspace_custom_extensions.sql',import.meta.url),'utf8'));
sqlite.exec(await readFile(new URL('../drizzle/0016_lllm_browser_authorizations.sql',import.meta.url),'utf8'));
sqlite.exec(await readFile(new URL('../drizzle/0017_workspace_extension_providers.sql',import.meta.url),'utf8'));
sqlite.prepare("INSERT INTO workspace_extension_providers(workspace_id,extension_id,source_workspace_id) VALUES(?,'lllm',?)").run(W,W);
const database={prepare(sql){let values=[];return {bind(...args){values=args;return this;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const r=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(r.changes)}};}};},async batch(queries){sqlite.exec('BEGIN');try{const r=await Promise.all(queries.map(q=>q.run()));sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const pair=generateKeyPairSync('rsa',{modulusLength:2048});
const state={database,user:'alice',env:{LLLM_CONNECTOR_TOKEN:'test-connector-secret',LLLM_PUBLIC_KEY:pair.publicKey.export({format:'der',type:'spki'}).toString('base64')}};
globalThis.__lllmTest=state;
await mkdir(new URL('../.sites-runtime/tests/',import.meta.url),{recursive:true});
const output=new URL('../.sites-runtime/tests/lllm-routes.mjs',import.meta.url);
await build({stdin:{contents:`export * as user from './app/api/workspaces/[slug]/extensions/lllm/route.ts';export * as connector from './app/api/lllm-connector/route.ts';export * as extensions from './app/api/workspaces/[slug]/extensions/route.ts';`,resolveDir:new URL('../',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')},bundle:true,format:'esm',platform:'node',outfile:output.pathname.replace(/^\/([A-Z]:)/,'$1'),plugins:[{name:'test-boundaries',setup(b){b.onResolve({filter:/^(cloudflare:workers|@\/lib\/(auth|db))$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},args=>({loader:'js',contents:args.path==='cloudflare:workers'?'export const env=globalThis.__lllmTest.env;':args.path==='@/lib/db'?'export const db=()=>globalThis.__lllmTest.database;':`export async function authorizeWorkspace(slug,roles){const t=globalThis.__lllmTest;if(!t.user)return {ok:false,response:Response.json({}, {status:401})};const m=await t.database.prepare('SELECT w.id AS workspace_id,w.slug,w.name,m.role FROM workspaces w JOIN account_memberships m ON m.workspace_id=w.id WHERE w.slug=? AND m.account_key=?').bind(slug,t.user).first();if(!m)return {ok:false,response:Response.json({}, {status:404})};if(roles&&!roles.includes(m.role))return {ok:false,response:Response.json({}, {status:403})};return {ok:true,user:{accountKey:t.user},membership:m};}` }));}}]});
const routes=await import(output.href);
const context=slug=>({params:Promise.resolve({slug:slug||'minamomura'})});
const browserSessions=new Map();
function sessionToken(slug='minamomura',account=state.user){
 if(!account)return null;
 const workspace=sqlite.prepare('SELECT id FROM workspaces WHERE slug=?').get(slug);if(!workspace)return null;
 const key=JSON.stringify([workspace.id,account]);if(browserSessions.has(key))return browserSessions.get(key);
 const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex'),now=Date.now();
 sqlite.prepare("INSERT INTO lllm_browser_authorizations(token_hash,kind,workspace_id,account_key,created_at,expires_at) VALUES(?,'session',?,?,?,?)").run(hash,workspace.id,account,now,now+4*60*60*1000);
 browserSessions.set(key,token);return token;
}
const req=(url,body,connector=false)=>{
 const slug=/^\/api\/workspaces\/([^/]+)\/extensions\/lllm(?:\?|$)/.exec(url)?.[1];
 const session=!connector&&slug?sessionToken(decodeURIComponent(slug)):null;
 return new Request(origin+url,{method:body?'POST':'GET',headers:connector?{authorization:'Bearer '+state.env.LLLM_CONNECTOR_TOKEN,'content-type':'application/json'}:{origin,'sec-fetch-site':'same-origin','content-type':'application/json','x-plotline-csrf':'lllm-relay',...(session?{'x-lllm-session':session}:{})},body:body?JSON.stringify(body):undefined});
};
const user=(body,slug='minamomura')=>routes.user.POST(req('/api/workspaces/'+slug+'/extensions/lllm',body),context(slug));
const get=(query='',slug='minamomura')=>routes.user.GET(req('/api/workspaces/'+slug+'/extensions/lllm'+query),context(slug));
const connector=async body=>routes.connector.POST(req('/api/lllm-connector',body,true));
const poll=async()=> (await connector({action:'poll',active:[]})).json();
await connector({action:'boot',active:[]});
const create=async (parts=1)=>{const id=randomUUID();assert.equal((await user({action:'create',id,parts})).status,201);return id;};
async function ready(){const id=await create();await user({action:'chunk',id,part:0,ciphertext:'YQ=='});assert.equal((await user({action:'submit',id})).status,200);return id;}
async function reset(){sqlite.exec("DELETE FROM lllm_bridge_chunks;DELETE FROM lllm_bridge_jobs;DELETE FROM lllm_browser_authorizations;UPDATE workspace_extensions SET enabled=1;");browserSessions.clear();state.user='alice';await connector({action:'poll',active:[]});}

test('migration corrects only the intended workspace and enables its extension',()=>{assert.equal(sqlite.prepare('SELECT name FROM workspaces WHERE id=?').get(W).name,'水無墓村');assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_extensions').get().n,1);});
test('anonymous, nonmembers and an identically named workspace cannot use the relay',async()=>{state.user=null;assert.equal((await get()).status,401);state.user='stranger';assert.equal((await get()).status,404);state.user='alice';assert.equal((await get('','other')).status,403);});
test('CSRF, malformed chunks, incomplete submissions and connector secrets are checked',async()=>{await reset();const invalid=req('/api/workspaces/minamomura/extensions/lllm',{id:randomUUID(),action:'create',parts:1});invalid.headers.delete('origin');assert.equal((await routes.user.POST(invalid,context())).status,403);assert.equal((await routes.connector.POST(req('/api/lllm-connector',{action:'poll'}))).status,401);const id=await create(2);assert.equal((await user({action:'chunk',id,part:2,ciphertext:'YQ=='})).status,409);assert.equal((await user({action:'submit',id})).status,409);const tooLarge=req('/api/workspaces/minamomura/extensions/lllm',{id,action:'chunk',ciphertext:'x'.repeat(182000)});assert.equal((await routes.user.POST(tooLarge,context())).status,400);});
test('jobs are claimed once; another member cannot read, overwrite or cancel them',async()=>{await reset();const id=await ready();const claims=await Promise.all([poll(),poll()]);assert.equal(claims.flatMap(p=>p.jobs).filter(j=>j.id===id).length,1);state.user='bob';assert.equal((await get('?id='+id)).status,404);assert.equal((await user({action:'delete',id})).status,404);state.user='alice';assert.equal((await get('?id='+id)).headers.get('cache-control').includes('no-store'),true);});
test('member removal stops pending and active operations and result access',async()=>{await reset();const id=await ready();assert.equal((await poll()).jobs.length,1);sqlite.prepare('DELETE FROM account_memberships WHERE workspace_id=? AND account_key=?').run(W,'alice');assert.deepEqual((await (await connector({action:'poll',active:[id]})).json()).active,[]);assert.equal((await connector({action:'write',id,part:0,ciphertext:'YQ=='})).status,404);assert.equal((await get('?id='+id)).status,404);sqlite.prepare('INSERT INTO account_memberships VALUES(?,?,?)').run(W,'alice','owner');});
test('disabling is owner-only and removes in-flight ciphertext',async()=>{await reset();await ready();const put=()=>new Request(origin+'/api/workspaces/minamomura/extensions',{method:'PUT',headers:{origin,'content-type':'application/json','x-plotline-csrf':'workspace-extensions'},body:JSON.stringify({id:'lllm',enabled:false})});state.user='bob';assert.equal((await routes.extensions.PUT(put(),context())).status,403);state.user='alice';assert.equal((await routes.extensions.PUT(put(),context())).status,200);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM lllm_bridge_chunks').get().n,0);assert.equal((await get()).status,403);});
test('restart fails claimed operations instead of replaying them; expiry deletes ciphertext',async()=>{await reset();const id=await ready();await poll();await connector({action:'boot',active:[]});assert.equal((await (await get('?id='+id)).json()).state,'failed');assert.equal((await poll()).jobs.length,0);sqlite.prepare('UPDATE lllm_bridge_jobs SET expires_at=0').run();await poll();assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM lllm_bridge_jobs').get().n,0);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM lllm_bridge_chunks').get().n,0);});
test('crypto rejects ciphertext modification and cross-job replay',()=>{const id=randomUUID(),key=randomBytes(32),iv=randomBytes(12);const c=createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from('lllm-v1:req:'+id));const sealed=Buffer.concat([publicEncrypt({key:pair.publicKey,oaepHash:'sha256'},key),iv,c.update(JSON.stringify({method:'GET',path:'/api/status',body:''})),c.final(),c.getAuthTag()]);assert.equal(openRequest(sealed,pair.privateKey,id).packet.path,'/api/status');assert.throws(()=>openRequest(sealed,pair.privateKey,randomUUID()));sealed[sealed.length-1]^=1;assert.throws(()=>openRequest(sealed,pair.privateKey,id));key.fill(0);sealed.fill(0);});
test('connector rejects filesystem, tools, raw backend, persistent keys and query escapes',()=>{for(const p of ['/api/tools/adrenalin','/internal/private/result/abc','/api/private/keys','/api/image/queue','http://evil/','/api/status?x=1','/api/private/files?recipient=any'])assert.equal(allowed('POST',p)||allowed('GET',p),false,p);assert.equal(allowed('POST','/api/private/reference'),true);assert.equal(allowed('POST','/api/chat'),true);});
test('browser transport round-trips a multi-chunk image through actual routes without storing plaintext',async()=>{await reset();let pump;
 const nativeFetch=async(input,options={})=>{const u=new URL(input,origin);const r=new Request(u,{...options,headers:{...options.headers,origin,'sec-fetch-site':'same-origin'}});const result=options.method==='POST'?await routes.user.POST(r,context()):await routes.user.GET(r,context());
  if(options.body&&JSON.parse(options.body).action==='submit')pump=(async()=>{const jobs=(await poll()).jobs;for(const job of jobs){let encoded='';for(let p=0;p<job.request_parts;p++)encoded+=(await (await connector({action:'read',id:job.id,part:p})).json()).ciphertext;assert.equal(encoded.includes('synthetic-private-image'),false);const opened=openRequest(Buffer.from(encoded,'base64'),pair.privateKey,job.id);assert.equal(opened.packet.path,'/api/private/reference');const bytes=Buffer.from(opened.packet.body,'base64');assert.equal(bytes.length,320000);const sealed=sealResponse({status:200,headers:{'content-type':'application/octet-stream'},body:bytes.toString('base64')},opened.key,job.id).toString('base64');for(let p=0;p<Math.ceil(sealed.length/180000);p++)await connector({action:'write',id:job.id,part:p,ciphertext:sealed.slice(p*180000,(p+1)*180000)});await connector({action:'complete',id:job.id,parts:Math.ceil(sealed.length/180000)});opened.key.fill(0);bytes.fill(0);}})();
  return result;};
 const meta={content:sessionToken(),removed:false,remove(){this.removed=true;}},historyCalls=[];
 const window={fetch:nativeFetch,addEventListener(){}};const sandbox={window,document:{currentScript:{remove(){}},querySelector(selector){return selector==='meta[name="lllm-session"]'?meta:{content:'minamomura'};}},history:{replaceState(...args){historyCalls.push(args);}},location:{origin,hash:'',reload(){}},crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Headers,Response,Blob,DOMException,URL,btoa,atob,setTimeout:(fn)=>setTimeout(fn,1)};
 vm.runInNewContext(await readFile(new URL('../lllm/relay.js',import.meta.url),'utf8'),sandbox);
 assert.equal(meta.removed,true);assert.equal(historyCalls.at(-1)[2],'/apps/lllm/minamomura');
 const bytes=new Uint8Array(320000).fill(123);const response=await window.fetch('/api/private/reference',{method:'POST',headers:{'content-type':'image/png'},body:new Blob([bytes])});assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);assert.equal(response.headers.get('cache-control'),'no-store');await pump;
});
test('dispatch gives each account an isolated identity and injects its token only in memory',async()=>{let seen;const result=await invoke({method:'GET',path:'/api/status',body:'',headers:{'x-control-token':'untrusted'}},'alice',randomUUID(),{getToken:()=> 'server-secret',markRequest(){},async dispatch(req,res){seen={peer:req.socket.remoteAddress,token:req.headers['x-control-token']};res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({current:'qwen25',models:[],memory:{},actionToken:'server-secret',meshIp:'private'}));}},new AbortController().signal);assert.deepEqual(seen,{peer:'workspace:alice',token:'server-secret'});const text=Buffer.from(result.body,'base64').toString();assert.equal(text.includes('server-secret'),false);assert.equal(text.includes('meshIp'),false);});
test('dynamic script and style responses prohibit caching and never resolve arbitrary assets',async()=>{
 const output=new URL('../.sites-runtime/tests/lllm-assets.mjs',import.meta.url);
 await build({entryPoints:['app/lllm-assets/[asset]/route.ts'],bundle:true,format:'esm',platform:'node',outfile:output.pathname.replace(/^\/([A-Z]:)/,'$1'),plugins:[{name:'raw-assets',setup(b){b.onResolve({filter:/\?raw$/},args=>({path:resolve(args.resolveDir,args.path.slice(0,-4)),namespace:'raw'}));b.onLoad({filter:/.*/,namespace:'raw'},async args=>({contents:await readFile(args.path,'utf8'),loader:'text'}));}}]});
 const assets=await import(output.href);
 for(const asset of ['relay.js','studio.js','studio.css','chat-crypto.js']){const r=await assets.GET(new Request(origin+'/lllm-assets/'+asset),{params:Promise.resolve({asset})});assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);assert.ok((await r.text()).length>100);}
 for(const asset of ['__proto__','constructor','../server.cjs'])assert.equal((await assets.GET(new Request(origin+'/lllm-assets/test'),{params:Promise.resolve({asset})})).status,404);
 assert.match(await readFile(new URL('../app/apps/lllm/[slug]/route.ts',import.meta.url),'utf8'),/clear-site-data/);
});

const install = (slug, enabled=true) => routes.extensions.PUT(new Request(origin+'/api/workspaces/'+slug+'/extensions', {
 method:'PUT',headers:{origin,'content-type':'application/json','x-plotline-csrf':'workspace-extensions'},
 body:JSON.stringify({id:'lllm',enabled})}),context(slug));

test('the server owner can install in the demo; unrelated owners and same names grant no access',async()=>{
 await reset();
 sqlite.exec("INSERT INTO workspaces VALUES('demo','demo','水無墓村デモ用','old'),('foreign','foreign','水無墓村','old');INSERT INTO account_memberships VALUES('demo','alice','owner'),('demo','bob','viewer'),('foreign','mallory','owner'),('foreign','alice','viewer');");
 const unprovided=await (await routes.extensions.GET(req('/api/workspaces/demo/extensions'),context('demo'))).json();
 assert.equal(unprovided.extensions.length,0);
 sqlite.prepare("INSERT INTO workspace_extension_providers(workspace_id,extension_id,source_workspace_id) VALUES(?,'lllm',?)").run('demo',W);
 const catalog=await (await routes.extensions.GET(req('/api/workspaces/demo/extensions'),context('demo'))).json();
 assert.equal(catalog.extensions[0].available,true);assert.equal(catalog.extensions[0].enabled,false);
 state.user='bob';assert.equal((await install('demo')).status,403);
 state.user='mallory';assert.equal((await install('foreign')).status,403);
 state.user='alice';assert.equal((await install('demo')).status,200);assert.equal((await get('','demo')).status,200);
 assert.equal((await get('','foreign')).status,403);
});

async function readyIn(slug){const id=randomUUID();assert.equal((await user({action:'create',id,parts:1},slug)).status,201);await user({action:'chunk',id,part:0,ciphertext:'YQ=='},slug);assert.equal((await user({action:'submit',id},slug)).status,200);return id;}

test('the same member is isolated across workspaces, including the local GPU identity',async()=>{
 await reset();const source=await readyIn('minamomura'),demo=await readyIn('demo');
 assert.equal((await get('?id='+source,'demo')).status,404);assert.equal((await user({action:'delete',id:source},'demo')).status,404);
 const claimed=(await poll()).jobs;assert.equal(claimed.length,2);
 assert.notEqual(claimed.find(j=>j.id===source).account_key,claimed.find(j=>j.id===demo).account_key);
 assert.equal((await connector({action:'read',id:demo,part:0})).status,200);
});

test('stopping the demo cleans only its data and keeps the source workspace usable',async()=>{
 await reset();const source=await readyIn('minamomura'),demo=await readyIn('demo');
 assert.equal((await install('demo',false)).status,200);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM lllm_bridge_jobs WHERE id=?').get(demo).n,0);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM lllm_bridge_jobs WHERE id=?').get(source).n,1);
 assert.equal((await get('','demo')).status,403);assert.equal((await get()).status,200);
});

test('removing the shared server owner revokes pending jobs, active jobs and results',async()=>{
 await reset();const id=await readyIn('demo');await poll();
 sqlite.prepare("UPDATE account_memberships SET role='editor' WHERE workspace_id=? AND account_key='alice'").run(W);
 try{assert.equal((await get('','demo')).status,403);assert.deepEqual((await (await connector({action:'poll',active:[id]})).json()).active,[]);assert.equal((await connector({action:'write',id,part:0,ciphertext:'YQ=='})).status,404);}
 finally{sqlite.prepare("UPDATE account_memberships SET role='owner' WHERE workspace_id=? AND account_key='alice'").run(W);}
});

test('workspace names are escaped and every return link stays in its own workspace',async()=>{
 const output=new URL('../.sites-runtime/tests/lllm-page.mjs',import.meta.url);
 await build({entryPoints:['lib/lllm-page.ts'],bundle:true,format:'esm',platform:'node',outfile:output.pathname.replace(/^\/([A-Z]:)/,'$1')});
 const {lllmPage}=await import(output.href);
 const page=lllmPage('demo','<img src=x onerror=alert(1)> & $&','a'.repeat(64));
 assert.ok(page.includes('&lt;img src=x onerror=alert(1)&gt; &amp; $&'));assert.ok(!page.includes('<img src=x'));
 assert.ok(page.includes('href="/w/demo"'));assert.ok(!page.includes('/w/minamomura'));
 assert.ok(page.includes('name="lllm-workspace" content="demo"'));assert.ok(page.includes('id="retryConnection"'));
});

test('image controls recover after an initial offline connection without reloading the page',async()=>{
 const nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='imageTarget'?'this':'',hidden:false,replaceChildren(){},append(){},addEventListener(){}});return nodes.get(id);};
 const window={addEventListener(){},dispatchEvent(){}};
 const document={getElementById:node,addEventListener(){},createElement(){return {};}};
 const sandbox={window,document,Event,console,Map,URL,TextDecoder,TextEncoder,Uint8Array,setTimeout,clearTimeout,setInterval,clearInterval};
 vm.runInNewContext(await readFile(new URL('../lllm/vault.js',import.meta.url),'utf8'),sandbox);
 let online=false;
 await window.PrivateImages.init({api:async()=>{if(!online)throw Error('offline');return {canUnlock:true,recipients:[]};}});
 assert.equal(window.PrivateImages.ready(),false);
 online=true;await window.PrivateImages.refresh();assert.equal(window.PrivateImages.ready(),true);
});

test('closing a page overwrites its throwaway image key and removes old result links',async()=>{
 const nodes=new Map(),events=new Map(),calls=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='imageTarget'?'this':'',hidden:false,replaceChildren(){},append(){},addEventListener(){},removeAttribute(name){delete this[name];}});return nodes.get(id);};
 const secret=new Uint8Array(32).fill(37);
 const window={addEventListener(name,fn){events.set(name,fn);},dispatchEvent(){}};
 const document={getElementById:node,addEventListener(){},createElement(){return {};}};
 const sandbox={window,document,Event,console,Map,URL,TextDecoder,TextEncoder,Uint8Array,setTimeout,clearTimeout,setInterval,clearInterval,
  StudioCrypto:{createSessionKey(){return {id:'throwaway-test-session',pub:new Uint8Array(32),secret};},base64(){return 'synthetic-public-key';}}};
 vm.runInNewContext(await readFile(new URL('../lllm/vault.js',import.meta.url),'utf8'),sandbox);
 await window.PrivateImages.init({api:async(path)=>{calls.push(path);return {canUnlock:true,recipients:[]};}});
 await window.PrivateImages.prepare();assert.equal(node('keyLock').hidden,false);
 node('editEncryptedDownload').href='/api/private/files/expired-test-result';events.get('pagehide')();
 assert.ok(secret.every(byte=>byte===0));assert.equal(node('keyLock').hidden,true);
 assert.equal(node('editEncryptedDownload').href,undefined);assert.ok(calls.includes('/api/private/session/release'));
});
