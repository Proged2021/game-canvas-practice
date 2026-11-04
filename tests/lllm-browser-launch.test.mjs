import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { MAX_RELAY_CHUNKS, MAX_ACCOUNT_RELAY_CHUNKS } from '../lib/lllm-capacity.ts';

const SOURCE='0279e5f9-6122-4fb9-90ff-b9073a9fc7c1', DEMO='browser-demo', FOREIGN='browser-foreign';
const ORIGIN='https://game-canvas.example';
const hash=token=>createHash('sha256').update(token).digest('hex');
const state={database:null,user:'alice',env:{LLLM_PUBLIC_KEY:'test-public-key',LLLM_CONNECTOR_TOKEN:'test-browser-connector'}};
globalThis.__lllmBrowserLaunchTest=state;
const directory=new URL('../drizzle/',import.meta.url);
const migrations=await Promise.all((await readdir(directory)).filter(name=>name.endsWith('.sql')).sort().map(name=>readFile(new URL(name,directory),'utf8')));
const bundle=await build({stdin:{contents:`
  export * as launch from './app/api/workspaces/[slug]/extensions/lllm/launch/route.ts';
  export * as page from './app/apps/lllm/[slug]/route.ts';
  export * as relay from './app/api/workspaces/[slug]/extensions/lllm/route.ts';
  export * as connector from './app/api/lllm-connector/route.ts';
  export * as extensions from './app/api/workspaces/[slug]/extensions/route.ts';
  export * as deletion from './lib/workspace-deletion.ts';`,resolveDir:fileURLToPath(new URL('../',import.meta.url))},
  bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'browser-launch-boundaries',setup(builder){
    builder.onResolve({filter:/^(cloudflare:workers|@\/app\/chatgpt-auth|@\/lib\/(account-principal|db|lllm-page))$/},args=>({path:args.path,namespace:'synthetic'}));
    builder.onLoad({filter:/.*/,namespace:'synthetic'},args=>({loader:'js',contents:
      args.path==='cloudflare:workers'?'export const env=globalThis.__lllmBrowserLaunchTest.env;'
      :args.path==='@/app/chatgpt-auth'?'export const getChatGPTUser=async()=>{const id=globalThis.__lllmBrowserLaunchTest.user;return id?{id}:null;};'
      :args.path==='@/lib/account-principal'?'export const principalForUser=async user=>({accountKey:user.id});'
      :args.path==='@/lib/lllm-page'?'export const lllmPage=(slug,name,session)=>`<main id="secured-lllm-startup" data-session="${session}" data-workspace="${slug}">${name}</main>`;'
      :`export const db=()=>globalThis.__lllmBrowserLaunchTest.database;
        export const getMembership=(slug,account)=>db().prepare('SELECT w.id AS workspace_id,w.slug,w.name,m.role FROM workspaces w JOIN account_memberships m ON m.workspace_id=w.id WHERE w.slug=? AND m.account_key=?').bind(slug,account).first();`
    }));
  }}]});
const routes=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
function fixture(t){
  const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());sqlite.exec('PRAGMA foreign_keys=ON');
  for(const migration of migrations)sqlite.exec(migration);
  const run=(sql,...values)=>sqlite.prepare(sql).run(...values);
  for(const [id,slug]of[[SOURCE,'minamomura'],[DEMO,'demo'],[FOREIGN,'foreign']]){
    run("INSERT INTO workspaces(id,slug,name,owner_email) VALUES (?,?,?,'account:alice')",id,slug,slug);
    run("INSERT INTO account_memberships(workspace_id,account_key,role) VALUES (?,'alice','owner')",id);
    run("INSERT INTO workspace_extensions VALUES (?,'lllm',1)",id);
  }
  for(const id of[SOURCE,DEMO])run("INSERT INTO workspace_extension_providers(workspace_id,extension_id,source_workspace_id) VALUES (?,'lllm',?)",id,SOURCE);
  for(const workspace of[SOURCE,DEMO])run("INSERT INTO account_memberships(workspace_id,account_key,role) VALUES (?,'bob','viewer')",workspace);
  run("INSERT INTO account_memberships(workspace_id,account_key,role) VALUES (?,'demo-only','viewer')",DEMO);
  run("INSERT INTO lllm_bridge_state VALUES ('server',?)",Date.now());
  let hook;
  const before=(sql,method)=>{if(hook?.match(sql,method)){const callback=hook.callback;hook=null;callback();}};
  const database={prepare(sql){let values=[];return{
    bind(...parameters){values=parameters;return this;},
    async first(){before(sql,'first');return sqlite.prepare(sql).get(...values)??null;},
    async all(){before(sql,'all');return{results:sqlite.prepare(sql).all(...values)};},
    async run(){before(sql,'run');const result=sqlite.prepare(sql).run(...values);return{success:true,meta:{changes:Number(result.changes)}};}
  };},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  state.database=database;state.user='alice';state.env.LLLM_PUBLIC_KEY='test-public-key';
  return{sqlite,run,before(match,callback){hook={match,callback};}};
}
const context=(slug='minamomura')=>({params:Promise.resolve({slug})});
function jsonRequest(path,body={},csrf='lllm-launch',headers={}){return new Request(ORIGIN+path,{method:'POST',headers:{origin:ORIGIN,'content-type':'application/json','sec-fetch-site':'same-origin','x-plotline-csrf':csrf,...headers},body:JSON.stringify(body)});}
const launch=(slug='minamomura',headers={})=>routes.launch.POST(jsonRequest(`/api/workspaces/${slug}/extensions/lllm/launch`,{},'lllm-launch',headers),context(slug));
const page=(url='/apps/lllm/minamomura',slug='minamomura',headers={})=>routes.page.GET(new Request(ORIGIN+url,{headers}),context(slug));
async function grant(slug='minamomura'){
  const response=await launch(slug);assert.equal(response.status,201,await response.clone().text());return response.json();
}
async function session(slug='minamomura'){
  const issued=await grant(slug), response=await page(issued.url,slug);assert.equal(response.status,200);
  const html=await response.text(),token=html.match(/data-session="([a-f0-9]{64})"/)?.[1];assert.ok(token);return token;
}
function get(token,slug='minamomura',query=''){
  return routes.relay.GET(new Request(`${ORIGIN}/api/workspaces/${slug}/extensions/lllm${query}`,{headers:token?{'x-lllm-session':token}:{}}),context(slug));
}
const post=(token,body,slug='minamomura')=>routes.relay.POST(jsonRequest(`/api/workspaces/${slug}/extensions/lllm`,body,'lllm-relay',token?{'x-lllm-session':token}:{}),context(slug));
const connector=body=>routes.connector.POST(new Request(ORIGIN+'/api/lllm-connector',{method:'POST',headers:{authorization:'Bearer '+state.env.LLLM_CONNECTOR_TOKEN,'content-type':'application/json'},body:JSON.stringify(body)}));
async function ready(cap){const id=randomUUID();assert.equal((await post(cap,{action:'create',id,parts:1})).status,201);assert.equal((await post(cap,{action:'chunk',id,part:0,ciphertext:'YQ=='})).status,200);assert.equal((await post(cap,{action:'submit',id})).status,200);return id;}
function privateResponse(response){assert.match(response.headers.get('cache-control')??'',/private.*no-store/);assert.equal(response.headers.get('referrer-policy'),'no-referrer');}

test('direct, searched and copied canonical URLs always return identical 404 without login redirects',async t=>{
  fixture(t);
  for(const user of[null,'alice','bob','demo-only','stranger']){
    state.user=user;
    for(const suffix of['','?workspace=minamomura','?launch=bad','?launch='+ 'a'.repeat(64),'?launch='+ 'b'.repeat(64)+'&launch='+ 'c'.repeat(64)]){
      const response=await page('/apps/lllm/minamomura'+suffix,'minamomura',{referer:ORIGIN+'/w/minamomura/extensions'});
      assert.equal(response.status,404);assert.equal(await response.text(),'404 Not Found');assert.equal(response.headers.get('location'),null);
      assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow, noarchive');privateResponse(response);
    }
  }
});

test('workspace launch issues a 60-second one-use grant, stores hashes only and creates an in-memory session capability',async t=>{
  const f=fixture(t);state.user='bob';
  const issued=await grant('demo'),token=new URL(issued.url,ORIGIN).searchParams.get('launch');
  assert.match(token,/^[a-f0-9]{64}$/);assert.ok(issued.expiresAt>Date.now()&&issued.expiresAt<=Date.now()+60_000);
  const record=f.sqlite.prepare('SELECT * FROM lllm_browser_authorizations').get();
  assert.equal(record.token_hash,hash(token));assert.equal(record.kind,'grant');assert.equal(record.workspace_id,DEMO);assert.equal(record.account_key,'bob');
  const response=await page(issued.url,'demo');assert.equal(response.status,200);privateResponse(response);
  const html=await response.text(),cap=html.match(/data-session="([a-f0-9]{64})"/)?.[1];assert.ok(cap);assert.ok(!html.includes(token));
  assert.equal((await page(issued.url,'demo')).status,404);
  const persisted=f.sqlite.prepare('SELECT * FROM lllm_browser_authorizations').get();
  assert.equal(persisted.kind,'session');assert.equal(persisted.token_hash,hash(cap));assert.ok(!JSON.stringify(persisted).includes(cap));
  assert.equal((await get(cap,'demo')).status,200);
});

test('launch POST requires same-origin JSON and dedicated CSRF; source membership remains mandatory',async t=>{
  const f=fixture(t);
  for(const headers of[{origin:'https://evil.example'},{'x-plotline-csrf':'lllm-relay'},{'content-type':'text/plain'},{'sec-fetch-site':'cross-site'}]){
    const response=await launch('demo',headers);assert.equal(response.status,403);privateResponse(response);
  }
  for(const [user,status]of[[null,401],['stranger',404],['demo-only',403]]){
    state.user=user;assert.equal((await launch('demo')).status,status);
  }
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM lllm_browser_authorizations').get().n,0);
});

test('a grant is bound to the account and workspace, including when the same account owns both',async t=>{
  fixture(t);const issued=await grant(),token=new URL(issued.url,ORIGIN).searchParams.get('launch');
  assert.equal((await page(`/apps/lllm/demo?launch=${token}`,'demo')).status,404);
  state.user='bob';assert.equal((await page(issued.url)).status,404);
  state.user='alice';assert.equal((await page(issued.url)).status,200);
});

test('expired grants and simultaneous duplicate navigation cannot open two sessions',async t=>{
  const f=fixture(t),expired=await grant();
  f.run('UPDATE lllm_browser_authorizations SET expires_at=?',Date.now()-1);
  assert.equal((await page(expired.url)).status,404);
  const live=await grant(),results=await Promise.all([page(live.url),page(live.url)]);
  assert.deepEqual(results.map(response=>response.status).sort(),[200,404]);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM lllm_browser_authorizations WHERE kind='session'").get().n,1);
});

test('grant consumption rechecks both memberships, the shared owner and enabled state in the atomic statement',async t=>{
  for(const revoke of['source-member','target-member','shared-owner','enabled']){
    const f=fixture(t);state.user='bob';const issued=await grant('demo');
    f.before((sql,method)=>method==='run'&&sql.startsWith('UPDATE lllm_browser_authorizations'),()=>{
      if(revoke==='source-member'||revoke==='target-member')f.run("DELETE FROM account_memberships WHERE workspace_id=? AND account_key='bob'",revoke==='source-member'?SOURCE:DEMO);
      else if(revoke==='shared-owner')f.run("UPDATE account_memberships SET role='viewer' WHERE workspace_id=? AND account_key='alice'",SOURCE);
      else f.run("UPDATE workspace_extensions SET enabled=0 WHERE workspace_id=?",DEMO);
    });
    assert.equal((await page(issued.url,'demo')).status,404,revoke);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM lllm_browser_authorizations WHERE kind='session'").get().n,0);
  }
});

test('grant issuance also refuses ownership changes between authorization and insert',async t=>{
  const f=fixture(t);
  f.before((sql,method)=>method==='run'&&sql.startsWith('INSERT INTO lllm_browser_authorizations'),()=>f.run("DELETE FROM account_memberships WHERE workspace_id=? AND account_key='alice'",SOURCE));
  assert.equal((await launch('demo')).status,429);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM lllm_browser_authorizations').get().n,0);
});

test('relay requires the session capability and binds it to the authenticated account and workspace',async t=>{
  fixture(t);const cap=await session();
  assert.equal((await get()).status,404);assert.equal((await get('a'.repeat(64))).status,404);
  assert.equal((await post(null,{action:'create',id:randomUUID(),parts:1})).status,404);
  assert.equal((await get(cap,'demo')).status,404);
  state.user='bob';assert.equal((await get(cap)).status,404);
  state.user='alice';const response=await get(cap);assert.equal(response.status,200);privateResponse(response);
  assert.deepEqual(await response.json(),{publicKey:'test-public-key'});
});

test('an expired or deleted session cannot read results or publish a job even after initial verification',async t=>{
  const f=fixture(t),cap=await session(),id=randomUUID();
  f.before((sql,method)=>method==='run'&&sql.startsWith('INSERT INTO lllm_bridge_jobs'),()=>f.run('DELETE FROM lllm_browser_authorizations'));
  assert.equal((await post(cap,{action:'create',id,parts:1})).status,429);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM lllm_bridge_jobs').get().n,0);
  const second=await session();
  f.run("INSERT INTO lllm_bridge_jobs(id,workspace_id,account_key,state,request_parts,response_parts,created_at,expires_at) VALUES (?,?,?,'done',1,1,?,?)",id,SOURCE,'alice',Date.now(),Date.now()+60_000);
  f.run("INSERT INTO lllm_bridge_chunks VALUES (?,'response',0,'YQ==')",id);
  f.run('INSERT INTO lllm_browser_job_sessions VALUES (?,?)',id,hash(second));
  f.before((sql,method)=>method==='first'&&sql.startsWith('SELECT c.ciphertext'),()=>f.run('DELETE FROM lllm_browser_authorizations'));
  assert.equal((await get(second,'minamomura',`?id=${id}&part=0`)).status,404);
  const third=await session();f.run('UPDATE lllm_browser_authorizations SET expires_at=?',Date.now()-1);
  assert.equal((await get(third)).status,404);
});

test('stopping or removing the workspace integration revokes its grants and sessions only',async t=>{
  for(const method of['PUT','DELETE']){
    const f=fixture(t),sourceSession=await session(),demoSession=await session('demo');await grant('demo');
    const response=await routes.extensions[method](new Request(ORIGIN+'/api/workspaces/demo/extensions',{method,headers:{origin:ORIGIN,'content-type':'application/json','x-plotline-csrf':'workspace-extensions'},body:JSON.stringify({id:'lllm',enabled:false})}),context('demo'));
    assert.equal(response.status,200);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM lllm_browser_authorizations WHERE workspace_id=?').get(DEMO).n,0);
    f.run("INSERT INTO workspace_extensions VALUES (?,'lllm',1) ON CONFLICT(workspace_id,extension_id) DO UPDATE SET enabled=1",DEMO);
    assert.equal((await get(demoSession,'demo')).status,404);assert.equal((await get(sourceSession)).status,200);
  }
});

test('jobs belong to the originating browser session, and legacy unbound jobs never reach the connector',async t=>{
  const f=fixture(t),first=await session(),second=await session(),id=await ready(first);
  assert.equal((await get(second,'minamomura',`?id=${id}`)).status,404);
  assert.equal((await post(second,{action:'delete',id})).status,404);
  const legacy=randomUUID();f.run("INSERT INTO lllm_bridge_jobs(id,workspace_id,account_key,state,request_parts,created_at,expires_at) VALUES (?,?,'alice','ready',1,?,?)",legacy,SOURCE,Date.now(),Date.now()+60_000);
  const polled=await(await connector({action:'poll',active:[]})).json();
  assert.deepEqual(polled.jobs.map(job=>job.id),[id]);assert.ok(!polled.jobs.some(job=>job.id===legacy));
});

test('session loss between connector listing and claim, or immediately before result publication, revokes execution',async t=>{
  const f=fixture(t),cap=await session(),id=await ready(cap);
  f.before((sql,method)=>method==='run'&&sql.startsWith("UPDATE lllm_bridge_jobs AS j SET state='claimed'"),()=>f.run('DELETE FROM lllm_browser_authorizations WHERE token_hash=?',hash(cap)));
  assert.deepEqual((await(await connector({action:'poll',active:[]})).json()).jobs,[]);
  const activeCap=await session(),active=await ready(activeCap);
  assert.equal((await(await connector({action:'poll',active:[]})).json()).jobs[0].id,active);
  f.before((sql,method)=>method==='run'&&sql.startsWith('INSERT INTO lllm_bridge_chunks'),()=>f.run('UPDATE lllm_browser_authorizations SET expires_at=? WHERE token_hash=?',Date.now()-1,hash(activeCap)));
  assert.equal((await connector({action:'write',id:active,part:0,ciphertext:'YQ=='})).status,404);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM lllm_bridge_chunks WHERE job_id=? AND direction='response'").get(active).n,0);
  assert.equal((await connector({action:'complete',id:active,parts:1})).status,404);
  assert.deepEqual((await(await connector({action:'poll',active:[active]})).json()).active,[]);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM lllm_bridge_jobs').get().n,0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM lllm_bridge_chunks').get().n,0);
});

test('closing one tab atomically clears its session and mapped ciphertext while keeping another tab usable',async t=>{
  for(const foreignKeys of[true,false]){
    const f=fixture(t),first=await session(),second=await session(),firstJob=await ready(first),secondJob=await ready(second);
    f.sqlite.exec(`PRAGMA foreign_keys=${foreignKeys?'ON':'OFF'}`);
    const response=await post(first,{action:'closeSession'});assert.equal(response.status,200);privateResponse(response);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM lllm_bridge_jobs WHERE id=?').get(firstJob).n,0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM lllm_bridge_chunks WHERE job_id=?').get(firstJob).n,0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM lllm_browser_job_sessions WHERE job_id=?').get(firstJob).n,0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM lllm_browser_authorizations WHERE token_hash=?').get(hash(first)).n,0);
    assert.equal((await get(first)).status,404);assert.equal((await get(second)).status,200);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM lllm_bridge_jobs WHERE id=?').get(secondJob).n,1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM lllm_bridge_chunks WHERE job_id=?').get(secondJob).n,1);
  }
});

test('launch grants and sessions are bounded per account and expired entries are removed on launch',async t=>{
  const f=fixture(t);
  for(let index=0;index<12;index++)assert.equal((await launch()).status,201);
  assert.equal((await launch()).status,429);
  f.run('UPDATE lllm_browser_authorizations SET expires_at=?',Date.now()-1);
  assert.equal((await launch()).status,201);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM lllm_browser_authorizations').get().n,1);
  f.run('DELETE FROM lllm_browser_authorizations');
  for(let index=0;index<24;index++)f.run("INSERT INTO lllm_browser_authorizations VALUES (?,'session',?,'alice',?,?)",hash(randomUUID()),SOURCE,Date.now(),Date.now()+60_000);
  assert.equal((await launch()).status,429);
});

test('workspace deletion removes its browser authorizations with FK enforcement disabled',async t=>{
  const f=fixture(t);await session();await grant('demo');
  f.sqlite.exec('PRAGMA foreign_keys=OFF');
  await routes.deletion.deleteWorkspaceGraph({id:DEMO,slug:'demo',name:'demo'});
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM lllm_browser_authorizations WHERE workspace_id=?').get(DEMO).n,0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM lllm_browser_authorizations WHERE workspace_id=?').get(SOURCE).n,1);
});

function fillCiphertextSlots(f, count, account='alice') {
  const rows=[];
  for(let remaining=count;remaining>0;){
    const id=randomUUID(),parts=Math.min(remaining,360);rows.push(id);
    f.run("INSERT INTO lllm_bridge_jobs(id,workspace_id,account_key,state,request_parts,created_at,expires_at) VALUES (?,?,?,'uploading',?,?,?)",id,SOURCE,account,parts,Date.now(),Date.now()+60_000);
    for(let part=0;part<parts;part++)f.run("INSERT INTO lllm_bridge_chunks VALUES (?,'request',?,'YQ==')",id,part);
    remaining-=parts;
  }
  return rows;
}

for(const kind of ['account','global']){
  test(`request uploads enforce the atomic ${kind} ciphertext budget, preserve immutable retries and recover after deletion`,async t=>{
    const f=fixture(t),cap=await session(),id=randomUUID();
    assert.equal((await post(cap,{action:'create',id,parts:3})).status,201);
    assert.equal((await post(cap,{action:'chunk',id,part:0,ciphertext:'YQ=='})).status,200);
    const limit=kind==='account'?MAX_ACCOUNT_RELAY_CHUNKS:MAX_RELAY_CHUNKS;
    if(kind==='account')fillCiphertextSlots(f,limit-1);
    else{fillCiphertextSlots(f,600,'bob');fillCiphertextSlots(f,limit-601,'demo-only');}
    const denied=await post(cap,{action:'chunk',id,part:1,ciphertext:'Yg=='});assert.equal(denied.status,429);privateResponse(denied);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM lllm_bridge_chunks').get().n,limit);
    assert.equal((await post(cap,{action:'chunk',id,part:0,ciphertext:'Yg=='})).status,200);
    assert.equal(f.sqlite.prepare("SELECT ciphertext FROM lllm_bridge_chunks WHERE job_id=? AND direction='request' AND part=0").get(id).ciphertext,'YQ==');
    f.run('DELETE FROM lllm_bridge_chunks WHERE rowid IN (SELECT rowid FROM lllm_bridge_chunks WHERE job_id<>? LIMIT 1)',id);
    assert.equal((await post(cap,{action:'chunk',id,part:1,ciphertext:'Yg=='})).status,200);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM lllm_bridge_chunks').get().n,limit);
  });
  test(`connector responses share the ${kind} ciphertext budget and cannot bypass it after claiming a job`,async t=>{
    const f=fixture(t),cap=await session(),id=await ready(cap);
    assert.equal((await(await connector({action:'poll',active:[]})).json()).jobs[0].id,id);
    assert.equal((await connector({action:'write',id,part:0,ciphertext:'YQ=='})).status,200);
    const limit=kind==='account'?MAX_ACCOUNT_RELAY_CHUNKS:MAX_RELAY_CHUNKS;
    if(kind==='account')fillCiphertextSlots(f,limit-2);
    else{fillCiphertextSlots(f,600,'bob');fillCiphertextSlots(f,limit-602,'demo-only');}
    assert.equal((await connector({action:'write',id,part:1,ciphertext:'Yg=='})).status,429);
    assert.equal((await connector({action:'write',id,part:0,ciphertext:'Yg=='})).status,200);
    assert.equal(f.sqlite.prepare("SELECT ciphertext FROM lllm_bridge_chunks WHERE job_id=? AND direction='response' AND part=0").get(id).ciphertext,'YQ==');
    assert.equal((await connector({action:'fail',id})).status,200);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM lllm_bridge_chunks WHERE job_id=?').get(id).n,0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM lllm_bridge_chunks').get().n,limit-2);
  });
}

test('capacity is checked in the upload statement even when another request fills the last slot after authorization',async t=>{
  const f=fixture(t),cap=await session(),id=randomUUID();
  assert.equal((await post(cap,{action:'create',id,parts:1})).status,201);
  const fillers=fillCiphertextSlots(f,MAX_ACCOUNT_RELAY_CHUNKS-1);
  f.before((sql,method)=>method==='run'&&sql.startsWith('INSERT INTO lllm_bridge_chunks'),()=>{
    const last=fillers.at(-1);f.run("INSERT INTO lllm_bridge_chunks VALUES (?,'response',0,'YQ==')",last);
  });
  assert.equal((await post(cap,{action:'chunk',id,part:0,ciphertext:'YQ=='})).status,429);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM lllm_bridge_chunks').get().n,MAX_ACCOUNT_RELAY_CHUNKS);
});
