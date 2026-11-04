import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('the OG edge export renders a PNG using precompiled WASM in Workers',async()=>{
  const root=path.dirname(fileURLToPath(import.meta.resolve('@vercel/og/package.json')));
  const temporary=await mkdtemp(path.join(os.tmpdir(),'game-canvas-og-edge-'));
  let worker;
  try{
    const font=await readFile(path.join(root,'dist/Geist-Regular.ttf'));
    const result=await build({
      stdin:{contents:`import {ImageResponse} from ${JSON.stringify(path.join(root,'dist/index.edge.js'))};
        export default {async fetch(request){
          const invalid=new URL(request.url).pathname==='/invalid';
          const response=new ImageResponse(invalid
            ? {type:'svg',props:{width:20,height:20,children:{type:'path><script',props:{}}}}
            : {type:'div',props:{style:{display:'flex',backgroundColor:'white',color:'black'},children:'Safe'}},
            {width:120,height:80});
          try{return new Response(await response.arrayBuffer(),response);}
          catch(error){return new Response(error.message,{status:422});}
        }};`,resolveDir:root,sourcefile:'og-edge-test.js'},
      bundle:true,format:'esm',platform:'neutral',write:false,target:'es2022',
      conditions:['workerd','worker','browser'],external:['node:*','module'],
      plugins:[{name:'worker-fixture-assets',setup(plugin){
        plugin.onResolve({filter:/\.wasm\?module$/},args=>({path:'./'+path.basename(args.path).replace('?module',''),external:true}));
        plugin.onLoad({filter:/index\.edge\.js$/},async args=>{
          const source=await readFile(args.path,'utf8');
          const expected=/var fallbackFont = fetch\(\s*new URL\("\.\/Geist-Regular\.ttf", import\.meta\.url\)\s*\)\.then\(\(res\) => res\.arrayBuffer\(\)\);/;
          assert.match(source,expected,'upstream edge font-loading structure is reviewed');
          return {contents:source.replace(expected,`var fallbackFont = Promise.resolve(Uint8Array.from(${JSON.stringify([...font])}).buffer);`),loader:'js'};
        });
      }}],
    });
    const scriptPath=path.join(temporary,'worker.mjs');
    await writeFile(scriptPath,result.outputFiles[0].text);
    const modules=[{type:'ESModule',path:scriptPath,contents:result.outputFiles[0].text}];
    for(const name of ['hb.wasm','yoga.wasm','resvg.wasm'])modules.push({type:'CompiledWasm',path:path.join(temporary,name),contents:await readFile(path.join(root,'dist',name))});
    worker=new Miniflare(convertV4MiniflareOptions({modules,modulesRoot:temporary,compatibilityDate:'2026-10-23',compatibilityFlags:['nodejs_compat'],host:'127.0.0.1'}));
    const response=await worker.dispatchFetch('https://og.test/');
    assert.equal(response.status,200);
    const bytes=Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
    assert.equal(bytes.readUInt32BE(16),120);
    assert.equal(bytes.readUInt32BE(20),80);
    const invalid=await worker.dispatchFetch('https://og.test/invalid');
    assert.equal(invalid.status,422);
    assert.match(await invalid.text(),/Invalid XML element name/);
  }finally{
    await worker?.dispose();
    await rm(temporary,{recursive:true,force:true});
  }
});
