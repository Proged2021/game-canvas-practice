import test from "node:test";
import assert from "node:assert/strict";
import { fetchConfluenceImageSnapshots } from "../lib/confluence-snapshot.ts";
const png = Uint8Array.from([137,80,78,71,13,10,26,10]);
const jpeg = Uint8Array.from([255,216,255,224,0,16,74,70,73,70]);
const base = {cloudId:"cloud",cloudUrl:"https://tenant.atlassian.net",pageId:"42",token:"synthetic-token",
  representations:[[{filename:"image.png",normalizedFilename:"image.png",attachmentId:"123"}]]};
function fetcher(binary:(url:URL,init?:RequestInit)=>Response, calls:URL[]=[]) {
  return (async (input:string|URL|Request,init?:RequestInit)=>{
    const url=new URL(String(input));calls.push(url);
    if(url.pathname.endsWith("/pages/42/attachments"))return Response.json({results:[{id:"123",pageId:"42",title:"image.png",
      mediaType:"image/png",fileSize:png.length,fileId:"file",downloadLink:"/wiki/download/attachments/42/image.png"}]});
    return binary(url,init);
  }) as typeof fetch;
}
test("numeric v2 IDs use the trusted att-prefixed v1 path before other download attempts",async()=>{
  const calls:URL[]=[];
  const result=await fetchConfluenceImageSnapshots({...base,fetcher:fetcher((url,init)=>{
    assert.equal(new Headers(init?.headers).get("authorization"),"Bearer synthetic-token");
    assert.ok(url.pathname.endsWith("/attachment/att123/download"));
    return new Response(png,{headers:{"content-type":"image/png"}});
  },calls)});
  assert.equal(result.assets.length,1);assert.deepEqual(result.failures,[]);
  assert.equal(calls.length,2);
});
test("a thumbnail may be transcoded while original downloads still require the original MIME",async()=>{
  const result=await fetchConfluenceImageSnapshots({...base,fetcher:fetcher(url=>{
    // An original advertised as PNG cannot silently return a JPEG.
    return new Response(jpeg,{headers:{"content-type":"image/jpeg"}});
  })});
  assert.equal(result.assets.length,1);assert.equal(result.assets[0].mime,"image/jpeg");
  assert.equal(result.diagnostics[0].stages.filter(s=>s.stage==="v1_attachment_download").length,2);
  assert.ok(result.diagnostics[0].stages.some(s=>s.stage==="v2_thumbnail_download"));
});
test("thumbnail HTML and MIME/signature mismatches remain rejected",async()=>{
  for(const response of [()=>new Response("<html>login</html>",{headers:{"content-type":"text/html"}}),
    ()=>new Response(jpeg,{headers:{"content-type":"image/png"}})]){
    const result=await fetchConfluenceImageSnapshots({...base,fetcher:fetcher(()=>response())});
    assert.equal(result.assets.length,0);assert.deepEqual(result.failures,["unsupported_mime"]);
  }
});
test("the added v1 fallback never sends OAuth credentials to the media CDN",async()=>{
  const result=await fetchConfluenceImageSnapshots({...base,fetcher:fetcher((url,init)=>{
    if(url.hostname==="api.atlassian.com")return new Response(null,{status:302,headers:{location:"https://api.media.atlassian.com/file/synthetic"}});
    assert.equal(new Headers(init?.headers).has("authorization"),false);
    return new Response(png,{headers:{"content-type":"image/png"}});
  })});
  assert.equal(result.assets.length,1);
});
