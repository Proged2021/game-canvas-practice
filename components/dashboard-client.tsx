"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronRight, LogOut, Plus, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
type Workspace = { slug: string; name: string; role: string; scene_count: number };
export function DashboardClient({ user, signOutPath }: { user: { displayName: string; email: string }; signOutPath: string }) {
  const [items, setItems] = useState<Workspace[]>([]), [name, setName] = useState(""), [loading, setLoading] = useState(true), [creating, setCreating] = useState(false), [open, setOpen] = useState(false);
  useEffect(() => { fetch("/api/workspaces").then(r => r.json()).then(d => setItems(d.workspaces ?? [])).finally(() => setLoading(false)); }, []);
  async function createWorkspace() { if (!name.trim()) return; setCreating(true); const r = await fetch("/api/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }); const d = await r.json(); if (r.ok) location.href = `/w/${d.workspace.slug}`; else setCreating(false); }
  return <main className="dashboard-shell"><header className="dash-topbar"><div className="brand"><span className="brand-mark"><Sparkles size={17} /></span><span>Plotline</span></div><div className="account"><span>{user.displayName}</span><a href={signOutPath} title="ログアウト"><LogOut size={16} /></a></div></header>
    <section className="dashboard-main"><div className="dashboard-heading"><div><p className="eyebrow">GAME DESIGN WORKSPACES</p><h1>企画を、場面ごとに育てる。</h1><p>Confluenceのストーリーを見ながら、チームの思考を一か所に積み重ねます。</p></div>
      <Dialog open={open} onOpenChange={setOpen}><DialogTrigger render={<Button className="primary-action"><Plus size={17} />ワークスペースを作成</Button>} /><DialogContent><DialogHeader><DialogTitle>新しいワークスペース</DialogTitle><DialogDescription>ゲームや企画の名前を入力してください。専用URLを発行します。</DialogDescription></DialogHeader><Input value={name} onChange={e => setName(e.target.value)} placeholder="例：星導の魔女 — Chapter 1" onKeyDown={e => e.key === "Enter" && createWorkspace()} /><Button onClick={createWorkspace} disabled={creating || !name.trim()}>{creating ? "作成中…" : "作成する"}</Button></DialogContent></Dialog>
    </div><div className="workspace-grid">{loading ? <div className="empty-card">読み込み中…</div> : items.length ? items.map(item => <Link className="workspace-card" key={item.slug} href={`/w/${item.slug}`}><div className="workspace-icon"><BookOpen size={20} /></div><div className="workspace-card-copy"><h2>{item.name}</h2><p><Users size={14} /> {item.role === "owner" ? "オーナー" : item.role === "editor" ? "編集者" : "閲覧者"}<span>·</span>{item.scene_count} 場面</p></div><ChevronRight size={19} className="card-arrow" /></Link>) : <div className="empty-card"><BookOpen size={24} /><strong>最初の企画書を作成しましょう</strong><span>作成したワークスペースはクラウドへ保存されます。</span></div>}</div></section></main>;
}
