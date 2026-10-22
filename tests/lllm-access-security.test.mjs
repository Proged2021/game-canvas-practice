import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';

const SOURCE='0279e5f9-6122-4fb9-90ff-b9073a9fc7c1';
const DEMO='10000000-0000-4000-8000-000000000002';
const NAMESAKE='10000000-0000-4000-8000-000000000003';
const ORIGIN='https://game-canvas.app';
const state={database:null,sqlite:null,user:'alice',env:{
  LLLM_PUBLIC_KEY:'synthetic-public-key',LLLM_CONNECTOR_TOKEN:'synthetic-connector-secret',SITE_MAINTENANCE:'0',
}};
globalThis.__lllmAccessSecurityTest=state;
const root=fileURLToPath(new URL('../',import.meta.url));
const bundled=await build({
  stdin:{contents:`
    export * as page from './app/apps/lllm/[slug]/route.ts';
    export * as relay from './app/api/workspaces/[slug]/extensions/lllm/route.ts';
    export * as connector from './app/api/lllm-connector/route.ts';
    export * as extensions from './app/api/workspaces/[slug]/extensions/route.ts';
    export * as assets from './app/lllm-assets/[asset]/route.ts';
  `,resolveDir:root},bundle:true,format:'esm',platform:'node',write:false,
  plugins:[{name:'lllm-security-account-and-runtime-boundaries',setup(builder){
    builder.onResolve({filter:/^(cloudflare:workers|@\/app\/chatgpt-auth|@\/lib\/(account-principal|db|lllm-page|lllm-assets))$/},args=>({path:args.path,namespace:'lllm-access-security'}));
    builder.onLoad({filter:/.*/,namespace:'lllm-access-security'},args=>({loader:'js',contents:
      args.path==='cloudflare:workers'?'export const env=globalThis.__lllmAccessSecurityTest.env;'
      :args.path==='@/app/chatgpt-auth'?`
        export const getChatGPTUser=async()=>{const id=globalThis.__lllmAccessSecurityTest.user;return id?{id}:null;};
        export const requireChatGPTUser=async()=>getChatGPTUser();
      `:args.path==='@/lib/account-principal'?'export const principalForUser=async user=>({accountKey:user.id});'
      :args.path==='@/lib/db'?`
        export const db=()=>globalThis.__lllmAccessSecurityTest.database;
        export const getMembership=async(slug,accountKey)=>db().prepare('SELECT w.id AS workspace_id,w.slug,w.name,m.role FROM workspaces w JOIN account_memberships m ON m.workspace_id=w.id WHERE w.slug=? AND m.account_key=?').bind(slug,accountKey).first();
      `:args.path==='@/lib/lllm-page'?'export const lllmPage=(slug,name)=>`<main id="secured-lllm-startup" data-slug="${slug}">${name}</main>`;'
      :'export const LLLM_ASSETS={"relay.js":"window.syntheticRelay=true;"};',
    }));
  }}],
});
const routes=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const migration=await readFile(new URL('../drizzle/0014_workspace_lllm.sql',import.meta.url),'utf8');

function fixture(t){
  const sqlite=new DatabaseSync(':memory:');
  t.after(()=>sqlite.close());
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE workspaces(id TEXT PRIMARY KEY,slug TEXT,name TEXT,updated_at TEXT);
    CREATE TABLE account_memberships(workspace_id TEXT,account_key TEXT,role TEXT,PRIMARY KEY(workspace_id,account_key));
  `);
  const insert=sqlite.prepare('INSERT INTO workspaces VALUES(?,?,?,?)');
  insert.run(SOURCE,'minamomura','水無墓村','old');
  insert.run(DEMO,'demo','水無墓村デモ用','old');
  insert.run(NAMESAKE,'namesake','水無墓村','old');
  const member=sqlite.prepare('INSERT INTO account_memberships VALUES(?,?,?)');
  for(const row of [
    [SOURCE,'alice','owner'],[SOURCE,'bob','viewer'],[SOURCE,'source-only','viewer'],
    [DEMO,'alice','owner'],[DEMO,'bob','viewer'],[DEMO,'demo-only','viewer'],
    [NAMESAKE,'mallory','owner'],
  ])member.run(...row);
  sqlite.exec(migration);
  sqlite.prepare("INSERT INTO workspace_extensions(workspace_id,extension_id,enabled) VALUES(?,'lllm',1)").run(DEMO);
  sqlite.prepare("INSERT INTO workspace_extensions(workspace_id,extension_id,enabled) VALUES(?,'lllm',1)").run(NAMESAKE);
  sqlite.prepare("INSERT INTO lllm_bridge_state(id,last_seen) VALUES('server',?)").run(Date.now());
  let beforeQuery;
  const applyHook=(sql,method)=>{
    if(!beforeQuery||!beforeQuery.match(sql,method))return;
    const callback=beforeQuery.callback;beforeQuery=undefined;callback();
  };
  const database={
    prepare(sql){let values=[];return {
      bind(...args){values=args;return this;},
      async first(){applyHook(sql,'first');return sqlite.prepare(sql).get(...values)??null;},
      async all(){applyHook(sql,'all');return {results:sqlite.prepare(sql).all(...values)};},
      async run(){applyHook(sql,'run');const result=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(result.changes)}};},
    };},
    async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}},
  };
  state.database=database;state.sqlite=sqlite;state.user='alice';
  state.env.LLLM_PUBLIC_KEY='synthetic-public-key';
  return {sqlite,beforeQuery(match,callback){beforeQuery={match,callback};}};
}
const context=(slug='minamomura')=>({params:Promise.resolve({slug})});
const noStore=response=>assert.match(response.headers.get('cache-control')??'',/no-store/);
function relayRequest(slug='minamomura',body,query=''){
  return new Request(`${ORIGIN}/api/workspaces/${slug}/extensions/lllm${query}`,{method:body?'POST':'GET',headers:{
    origin:ORIGIN,'sec-fetch-site':'same-origin','content-type':'application/json','x-plotline-csrf':'lllm-relay',
  },body:body?JSON.stringify(body):undefined});
}
const get=(slug='minamomura',query='')=>routes.relay.GET(relayRequest(slug,undefined,query),context(slug));
const post=(slug,body)=>routes.relay.POST(relayRequest(slug,body),context(slug));
const page=(slug='minamomura',query='')=>routes.page.GET(new Request(`${ORIGIN}/apps/lllm/${slug}${query}`),context(slug));
const connector=body=>routes.connector.POST(new Request(`${ORIGIN}/api/lllm-connector`,{method:'POST',headers:{
  authorization:`Bearer ${state.env.LLLM_CONNECTOR_TOKEN}`,'content-type':'application/json',
},body:JSON.stringify(body)}));
function insertJob(sqlite,{workspaceId=DEMO,account='bob',status='ready',expiresAt=Date.now()+60_000}={}){
  const id=randomUUID();
  sqlite.prepare('INSERT INTO lllm_bridge_jobs(id,workspace_id,account_key,request_parts,created_at,expires_at,state,response_parts) VALUES(?,?,?,?,?,?,?,?)')
    .run(id,workspaceId,account,1,Date.now(),expiresAt,status,status==='done'?1:0);
  sqlite.prepare("INSERT INTO lllm_bridge_chunks(job_id,direction,part,ciphertext) VALUES(?,?,0,'YQ==')")
    .run(id,status==='done'?'response':'request');
  return id;
}

test('anonymous direct links never render the LLLM startup page or expose relay credentials',async t=>{
  const f=fixture(t);state.user=null;
  for(const slug of ['minamomura','demo']){
    const html=await page(slug,'?workspace=minamomura');
    assert.ok([401,403,404,303,307].includes(html.status));
    noStore(html);
    assert.doesNotMatch(await html.text(),/secured-lllm-startup|synthetic-public-key/);
    const info=await get(slug);
    assert.equal(info.status,401);
    noStore(info);
    assert.doesNotMatch(await info.text(),/synthetic-public-key/);
    assert.equal((await post(slug,{action:'create',id:randomUUID(),parts:1})).status,401);
  }
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM lllm_bridge_jobs').get().n,0);
});

test('demo-only membership cannot open HTML, obtain the public key or create a job',async t=>{
  const f=fixture(t);state.user='demo-only';
  const html=await page('demo');
  assert.equal(html.status,403);
  assert.doesNotMatch(await html.text(),/secured-lllm-startup/);
  assert.equal((await get('demo')).status,403);
  assert.equal((await post('demo',{action:'create',id:randomUUID(),parts:1})).status,403);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM lllm_bridge_jobs').get().n,0);
});

test('query strings and request-body workspace substitutions cannot bypass original membership',async t=>{
  fixture(t);state.user='demo-only';
  for(const query of ['?workspace=minamomura',`?workspaceId=${SOURCE}&slug=minamomura`,'?workspace=demo#chat']){
    assert.equal((await page('demo',query)).status,403);
    assert.equal((await get('demo',query)).status,403);
  }
  assert.equal((await post('demo',{action:'create',id:randomUUID(),parts:1,workspace_id:SOURCE,slug:'minamomura',account_key:'alice'})).status,403);
  assert.equal((await page('minamomura','?workspace=demo')).status,404);
});

test('members of both source and target, including viewers, can open the enabled application',async t=>{
  fixture(t);state.user='bob';
  for(const slug of ['minamomura','demo']){
    const html=await page(slug);
    assert.equal(html.status,200);
    assert.match(await html.text(),/secured-lllm-startup/);
    const info=await get(slug);
    assert.equal(info.status,200);
    assert.equal((await info.json()).publicKey,'synthetic-public-key');
    assert.equal((await post(slug,{action:'create',id:randomUUID(),parts:1})).status,201);
  }
});

test('original membership alone does not grant membership of the launch workspace',async t=>{
  fixture(t);state.user='source-only';
  assert.equal((await page('minamomura')).status,200);
  assert.equal((await page('demo')).status,404);
  assert.equal((await get('demo')).status,404);
  assert.equal((await post('demo',{action:'create',id:randomUUID(),parts:1})).status,404);
});

test('an identically named workspace and its owner receive no access through the name or shared link',async t=>{
  const f=fixture(t);state.user='mallory';
  assert.equal((await page('namesake')).status,403);
  assert.equal((await get('namesake')).status,403);
  assert.equal((await page('minamomura')).status,404);
  f.sqlite.prepare('INSERT INTO account_memberships VALUES(?,?,?)').run(NAMESAKE,'bob','viewer');
  state.user='bob';
  assert.equal((await page('namesake')).status,403,'both memberships do not make an unrelated owner eligible');
});

test('extension discovery hides availability and owners cannot enable it without original membership',async t=>{
  const f=fixture(t);state.user='demo-only';
  const catalog=await routes.extensions.GET(new Request(`${ORIGIN}/api/workspaces/demo/extensions`),context('demo'));
  assert.equal(catalog.status,200);noStore(catalog);
  assert.equal((await catalog.json()).extensions.find(item=>item.id==='lllm').available,false);
  f.sqlite.prepare("UPDATE account_memberships SET role='owner' WHERE workspace_id=? AND account_key='demo-only'").run(DEMO);
  const install=new Request(`${ORIGIN}/api/workspaces/demo/extensions`,{method:'PUT',headers:{
    origin:ORIGIN,'content-type':'application/json','x-plotline-csrf':'workspace-extensions',
  },body:JSON.stringify({id:'lllm',enabled:true})});
  assert.equal((await routes.extensions.PUT(install,context('demo'))).status,403);
});

test('existing queued jobs for demo-only actors cannot be claimed by the PC connector',async t=>{
  const f=fixture(t);
  const id=insertJob(f.sqlite,{account:'demo-only'});
  const response=await connector({action:'poll',active:[]});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.jobs.some(job=>job.id===id),false);
});

test('existing claimed jobs for demo-only actors cannot be read, written or completed',async t=>{
  const f=fixture(t);
  const id=insertJob(f.sqlite,{account:'demo-only',status:'claimed'});
  for(const action of [{action:'read',id,part:0},{action:'write',id,part:0,ciphertext:'YQ=='},{action:'complete',id,parts:1}]){
    assert.equal((await connector(action)).status,404);
  }
  assert.deepEqual((await (await connector({action:'poll',active:[id]})).json()).active,[]);
});

test('removing original membership revokes app, API, queued/active jobs and completed result access',async t=>{
  const f=fixture(t);state.user='bob';
  const pending=insertJob(f.sqlite,{status:'ready'});
  const active=insertJob(f.sqlite,{status:'claimed'});
  const done=insertJob(f.sqlite,{status:'done'});
  assert.equal((await get('demo',`?id=${done}&part=0`)).status,200);
  f.sqlite.prepare('DELETE FROM account_memberships WHERE workspace_id=? AND account_key=?').run(SOURCE,'bob');
  assert.equal((await page('demo')).status,403);
  assert.equal((await get('demo',`?id=${done}&part=0`)).status,403);
  assert.equal((await post('demo',{action:'chunk',id:pending,part:0,ciphertext:'YQ=='})).status,403);
  const polled=await (await connector({action:'poll',active:[active]})).json();
  assert.equal(polled.jobs.some(job=>job.id===pending),false);
  assert.deepEqual(polled.active,[]);
  assert.equal((await connector({action:'read',id:active,part:0})).status,404);
  assert.equal((await connector({action:'write',id:active,part:0,ciphertext:'YQ=='})).status,404);
});

test('removing target membership also revokes the app, active operations and results',async t=>{
  const f=fixture(t);state.user='bob';
  const active=insertJob(f.sqlite,{status:'claimed'});
  const done=insertJob(f.sqlite,{status:'done'});
  f.sqlite.prepare('DELETE FROM account_memberships WHERE workspace_id=? AND account_key=?').run(DEMO,'bob');
  assert.equal((await page('demo')).status,404);
  assert.equal((await get('demo',`?id=${done}&part=0`)).status,404);
  assert.equal((await connector({action:'read',id:active,part:0})).status,404);
  assert.deepEqual((await (await connector({action:'poll',active:[active]})).json()).active,[]);
});

test('membership revoked after request authorization cannot publish an uploaded request chunk',async t=>{
  const f=fixture(t);state.user='bob';
  const id=randomUUID();
  assert.equal((await post('demo',{action:'create',id,parts:1})).status,201);
  f.beforeQuery((sql,method)=>method==='run'&&/INSERT INTO lllm_bridge_chunks/i.test(sql),()=>{
    f.sqlite.prepare('DELETE FROM account_memberships WHERE workspace_id=? AND account_key=?').run(SOURCE,'bob');
  });
  const response=await post('demo',{action:'chunk',id,part:0,ciphertext:'YQ=='});
  assert.ok([403,404,409].includes(response.status));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM lllm_bridge_chunks WHERE job_id=?').get(id).n,0);
});

test('membership revoked immediately before a result read cannot expose its ciphertext',async t=>{
  const f=fixture(t);state.user='bob';
  const id=insertJob(f.sqlite,{status:'done'});
  f.beforeQuery((sql,method)=>method==='first'&&/SELECT[\s\S]*ciphertext/i.test(sql),()=>{
    f.sqlite.prepare('DELETE FROM account_memberships WHERE workspace_id=? AND account_key=?').run(SOURCE,'bob');
  });
  const response=await get('demo',`?id=${id}&part=0`);
  assert.equal(response.status,404);
  assert.doesNotMatch(await response.text(),/YQ==/);
});

test('membership revoked between connector listing and claiming prevents the claim',async t=>{
  const f=fixture(t);
  const id=insertJob(f.sqlite,{status:'ready'});
  let revoked=false;
  f.beforeQuery((sql,method)=>method==='run'&&/UPDATE lllm_bridge_jobs(?: AS j)? SET state='claimed'/i.test(sql),()=>{
    revoked=true;
    f.sqlite.prepare('DELETE FROM account_memberships WHERE workspace_id=? AND account_key=?').run(SOURCE,'bob');
  });
  const result=await (await connector({action:'poll',active:[]})).json();
  assert.equal(revoked,true);
  assert.equal(result.jobs.some(job=>job.id===id),false);
  assert.equal(f.sqlite.prepare('SELECT state FROM lllm_bridge_jobs WHERE id=?').get(id).state,'ready');
});

test('membership revoked immediately before a connector result write prevents publication',async t=>{
  const f=fixture(t);
  const id=insertJob(f.sqlite,{status:'claimed'});
  f.beforeQuery((sql,method)=>method==='run'&&/INSERT INTO lllm_bridge_chunks/i.test(sql),()=>{
    f.sqlite.prepare('DELETE FROM account_memberships WHERE workspace_id=? AND account_key=?').run(SOURCE,'bob');
  });
  assert.equal((await connector({action:'write',id,part:0,ciphertext:'YQ=='})).status,404);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM lllm_bridge_chunks WHERE job_id=? AND direction='response'").get(id).n,0);
});

test('results remain scoped to their account and workspace even for users with both memberships',async t=>{
  const f=fixture(t);state.user='bob';
  const id=insertJob(f.sqlite,{status:'done'});
  assert.equal((await get('demo',`?id=${id}&part=0`)).status,200);
  assert.equal((await get('minamomura',`?id=${id}&part=0`)).status,404);
  state.user='alice';
  assert.equal((await get('demo',`?id=${id}&part=0`)).status,404);
  assert.equal((await post('demo',{action:'delete',id})).status,404);
});

test('expired jobs and ciphertext cannot be read, resumed or returned by the connector',async t=>{
  const f=fixture(t);state.user='bob';
  const done=insertJob(f.sqlite,{status:'done',expiresAt:Date.now()-1});
  const active=insertJob(f.sqlite,{status:'claimed',expiresAt:Date.now()-1});
  assert.equal((await get('demo',`?id=${done}&part=0`)).status,404);
  assert.equal((await connector({action:'read',id:active,part:0})).status,404);
  assert.equal((await connector({action:'write',id:active,part:0,ciphertext:'YQ=='})).status,404);
  await connector({action:'poll',active:[active]});
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM lllm_bridge_jobs').get().n,0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM lllm_bridge_chunks').get().n,0);
});

test('application HTML, API responses and code assets prohibit storage in HTTP caches',async t=>{
  fixture(t);state.user='bob';
  const html=await page('demo');
  assert.equal(html.status,200);noStore(html);
  assert.equal(html.headers.get('pragma'),'no-cache');
  assert.equal(html.headers.get('expires'),'0');
  assert.equal(html.headers.get('x-frame-options'),'DENY');
  assert.equal(html.headers.get('clear-site-data'),'"cache"');
  noStore(await get('demo'));
  noStore(await connector({action:'poll',active:[]}));
  const asset=await routes.assets.GET(new Request(`${ORIGIN}/lllm-assets/relay.js`),{params:Promise.resolve({asset:'relay.js'})});
  noStore(asset);
  state.user='demo-only';noStore(await page('demo'));noStore(await get('demo'));
});

test('disabling the target extension or removing its public key blocks newly opened pages and APIs',async t=>{
  const f=fixture(t);state.user='bob';
  f.sqlite.prepare("UPDATE workspace_extensions SET enabled=0 WHERE workspace_id=? AND extension_id='lllm'").run(DEMO);
  assert.equal((await page('demo')).status,403);assert.equal((await get('demo')).status,403);
  f.sqlite.prepare("UPDATE workspace_extensions SET enabled=1 WHERE workspace_id=? AND extension_id='lllm'").run(DEMO);
  delete state.env.LLLM_PUBLIC_KEY;
  assert.equal((await page('demo')).status,403);assert.equal((await get('demo')).status,403);
});
