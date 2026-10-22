"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Puzzle } from "lucide-react";

type Extension = { id: string; name: string; description: string; available: boolean; enabled: boolean; online: boolean; href: string };
export function WorkspaceExtensions({ slug, initiallyOpen=false }: { slug: string; initiallyOpen?: boolean }) {
  const [open,setOpen]=useState(initiallyOpen),[items,setItems]=useState<Extension[]>([]),[manage,setManage]=useState(false),[error,setError]=useState(""),[saving,setSaving]=useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {const r=await fetch(`/api/workspaces/${encodeURIComponent(slug)}/extensions`,{cache:"no-store",signal});const d=await r.json() as {error?: string; extensions: Extension[]; canManage: boolean};if(!r.ok)throw Error(d.error);if(signal?.aborted)return;setItems(d.extensions);setManage(d.canManage);setError("");}catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:"拡張機能を読み込めません");}
  }, [slug]);
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);const timer=setInterval(()=>void load(controller.signal),open?15000:30000);return()=>{controller.abort();clearInterval(timer);};},[load,open]);
  async function toggle(e: Extension){setSaving(true);setError("");try{const r=await fetch(`/api/workspaces/${encodeURIComponent(slug)}/extensions`,{method:"PUT",headers:{"content-type":"application/json","x-plotline-csrf":"workspace-extensions"},body:JSON.stringify({id:e.id,enabled:!e.enabled})});const d=await r.json() as {error?:string};if(!r.ok)throw Error(d.error);await load();}catch(err){setError(err instanceof Error?err.message:"設定を変更できません");}finally{setSaving(false);}}
  return <>
    {items.filter(e=>e.enabled&&e.available).map(e=><Button key={e.id} variant="outline" size="sm" asChild><a href={e.href} target="_blank" rel="noopener noreferrer">AI STUDIOを開く ↗</a></Button>)}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm" aria-label="ワークスペースの拡張機能"><Puzzle size={15} /><span>拡張機能</span></Button></DialogTrigger>
      <DialogContent><DialogHeader><DialogTitle>ワークスペースの拡張機能</DialogTitle>
        <DialogDescription>このワークスペースで使うアプリを選びます。追加・停止はオーナーが変更できます。</DialogDescription></DialogHeader>
        {items.map(e=><div key={e.id} style={{border:"1px solid var(--border)",borderRadius:12,padding:18,display:"grid",gap:12}}>
          <strong>{e.name}</strong><p>{e.description}</p>
          {!e.available?<p>このAIサーバーの所有者が管理するワークスペースで利用できます。</p>:<><p role="status">{e.enabled?(e.online?"追加済み · 利用できます":"追加済み · AIサーバーの起動待ち"):"未追加"}</p>{e.enabled&&!e.online&&<p>PC側のAI STUDIOが起動すると接続します。開いた画面でも自動で接続を確認します。</p>}<div style={{display:"flex",gap:8}}>
            {e.enabled&&<Button asChild><a href={e.href} target="_blank" rel="noopener noreferrer">別タブで開く ↗</a></Button>}
            {manage&&<Button variant="outline" disabled={saving} onClick={()=>void toggle(e)}>{e.enabled?"停止する":"追加する"}</Button>}
          </div></>}
        </div>)}
        {error&&<div role="alert"><p>{error}</p><Button variant="outline" onClick={()=>void load()}>再読み込み</Button></div>}
      </DialogContent>
    </Dialog>
  </>;
}
