import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {createElement} from 'react';
import {fetch} from 'undici';
import {z} from 'zod';
import {ImageResponse} from '@vercel/og';

test('fetch rejects mismatching integrity even when the algorithm token is uppercase', async()=>{
  const body='bounded-public-probe';
  const digest=value=>createHash('sha256').update(value).digest('base64');
  await assert.rejects(fetch('data:text/plain,'+body,{integrity:'SHA256-'+digest('different')}),/fetch failed/);
  const response=await fetch('data:text/plain,'+body,{integrity:'SHA256-'+digest(body)});
  assert.equal(await response.text(),body);
});

test('oversized constrained collections stop before accumulating per-element issues',()=>{
  let visited=0;
  const element=z.string().refine(()=>{visited++;return false;});
  const schema=z.array(element).max(2);
  const result=schema.safeParse(Array(1000).fill('bad'));
  assert.equal(result.success,false);
  assert.equal(result.error.issues.length,1);
  assert.equal(result.error.issues[0].code,'too_big');
  assert.equal(visited,0);
  assert.deepEqual(z.array(z.string()).max(2).parse(['safe']),['safe']);
  for(const [container,input] of [
    [z.set(z.string()).max(1),new Set([1,2])],
    [z.map(z.string(),z.string()).max(1),new Map([[1,1],[2,2]])],
  ]){
    const invalid=container.safeParse(input);
    assert.equal(invalid.success,false);
    assert.equal(invalid.error.issues.length,1);
    assert.equal(invalid.error.issues[0].code,'too_big');
  }
});

test('the OG dependency escapes nested SVG text and attributes rather than emitting markup',async()=>{
  const ogRequire=createRequire(import.meta.resolve('@vercel/og/package.json'));
  const imported=ogRequire('satori'),satori=imported.default||imported;
  const font=await readFile(new URL('./dist/Geist-Regular.ttf',import.meta.resolve('@vercel/og/package.json')));
  const svg=await satori({type:'svg',props:{width:20,height:20,viewBox:'0 0 20 20',style:{width:20,height:20},children:[
    {type:'rect',props:{width:20,height:20,fill:'red" onload="synthetic()'}},
    {type:'desc',props:{children:'<script>synthetic()</script>'}},
  ]}},{width:20,height:20,fonts:[{name:'Geist',data:font,weight:400,style:'normal'}]});
  const embedded=svg.match(/href="data:image\/svg\+xml;utf8,([^"]+)"/);
  assert.ok(embedded,'nested SVG uses an embedded image');
  const content=decodeURIComponent(embedded[1]);
  assert.doesNotMatch(content,/<script>|fill="red" onload=/);
  assert.match(content,/fill="red&quot; onload=&quot;synthetic\(\)"/);
  assert.match(content,/&lt;script&gt;synthetic\(\)&lt;\/script&gt;/);
});

test('the retained ImageResponse API still renders a normal PNG',async()=>{
  const response=new ImageResponse(createElement('div',{style:{display:'flex',width:'100%',height:'100%',backgroundColor:'white',color:'black'}},'Safe'),{width:120,height:80});
  const bytes=Buffer.from(await response.arrayBuffer());
  assert.deepEqual(bytes.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
  assert.equal(bytes.readUInt32BE(16),120);
  assert.equal(bytes.readUInt32BE(20),80);
});

test('the bundled PNG renderer rejects structural SVG injection and caller internal styles',async()=>{
  const svg=child=>createElement('svg',{width:20,height:20,viewBox:'0 0 20 20'},child);
  for(const [element,message] of [
    [svg(createElement('path><path data-pwned="true"')),/Invalid XML element name/],
    [svg(createElement('path',{'data-label" data-pwned':'true'})),/Invalid XML attribute name/],
    [createElement('div',{style:{_inheritedClipPathId:'x)"/><rect width="100"/>'}},'safe'),/Invalid style property/],
    [createElement('div',{style:{_inheritedBackgroundClipTextPath:{value:'</clipPath><rect width="100"/>'}}},'safe'),/Invalid style property/],
  ]){
    const response=new ImageResponse(element,{width:120,height:80});
    await assert.rejects(response.arrayBuffer(),message);
  }
});
