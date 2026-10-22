"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Puzzle } from "lucide-react";

type Extension = { id: string; name: string; description: string; available: boolean; enabled: boolean; online: boolean; href: string };
export function WorkspaceExtensions({ slug }: { slug: string }) {
  const [open,setOpen]=useState(false),[items,setItems]=useState<Extension[]>([]),[manage,setManage]=useState(false),[error,setError]=useState(""),[saving,setSaving]=useState(false);
  async function load() {
    try {const r=await fetch(`/api/workspaces/${encodeURIComponent(slug)}/extensions`,{cache:"no-store"});const d=await r.json() as {error?: string; extensions: Extension[]; canManage: boolean};if(!r.ok)throw Error(d.error);setItems(d.extensions);setManage(d.canManage);}catch(e){setError(e instanceof Error?e.message:"拡張機能を読み込めません");}
  }
  useEffect(()=>{void load();},[slug]);
  async function toggle(e: Extension){setSaving(true);setError("");try{const r=await fetch(`/api/workspaces/${encodeURIComponent(slug)}/extensions`,{method:"PUT",headers:{"content-type":"application/json","x-plotline-csrf":"workspace-extensions"},body:JSON.stringify({id:e.id,enabled:!e.enabled})});const d=await r.json() as {error?:string};if(!r.ok)throw Error(d.error);await load();}catch(err){setError(err instanceof Error?err.message:"設定を変更できません");}finally{setSaving(false);}}
  return <>
    {items.filter(e=>e.enabled&&e.available).map(e=><Button key={e.id} variant="outline" size="sm" asChild><a href={e.href} target="_blank" rel="noopener noreferrer">LLLMを開く ↗</a></Button>)}
    <Dialog open={open} onOpenChange={v=>{setOpen(v);if(v)void load();}}>
      <DialogTrigger asChild><Button variant="outline" size="sm" aria-label="ワークスペースの拡張機能"><Puzzle size={15} /><span>拡張機能</span></Button></DialogTrigger>
      <DialogContent><DialogHeader><DialogTitle>ワークスペースの拡張機能</DialogTitle>
        <DialogDescription>このワークスペースで使うアプリを選びます。追加・停止はオーナーが変更できます。</DialogDescription></DialogHeader>
        {items.map(e=><div key={e.id} style={{border:"1px solid var(--border)",borderRadius:12,padding:18,display:"grid",gap:12}}>
          <strong>{e.name}</strong><p>{e.description}</p>
          {!e.available?<p>水無墓村ワークスペースで利用できます。</p>:<><p>{e.enabled?(e.online?"追加済み · サーバーに接続中":"追加済み · サーバーの接続待ち"):"未追加"}</p><div style={{display:"flex",gap:8}}>
            {e.enabled&&<Button asChild><a href={e.href} target="_blank" rel="noopener noreferrer">別タブで開く ↗</a></Button>}
            {manage&&<Button variant="outline" disabled={saving} onClick={()=>void toggle(e)}>{e.enabled?"停止する":"追加する"}</Button>}
          </div></>}
        </div>)}
        {error&&<p role="alert">{error}</p>}
      </DialogContent>
    </Dialog>
  </>;
}
