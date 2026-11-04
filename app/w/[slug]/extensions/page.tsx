import { notFound } from "next/navigation";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { principalForUser } from "@/lib/account-principal";
import { getMembership } from "@/lib/db";
import { WorkspaceExtensions } from "@/components/workspace-extensions";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ExtensionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const identity = await requireChatGPTUser(`/w/${encodeURIComponent(slug)}/extensions`);
  const user = await principalForUser(identity);
  const membership = await getMembership(slug, user.accountKey);
  if (!membership) notFound();
  return <main className="extensions-page">
    <div className="extensions-page-topbar"><a href={`/w/${encodeURIComponent(slug)}`}><ArrowLeft size={16} /><span>{membership.name}に戻る</span></a></div>
    <div className="extensions-page-content">
      <header><p>ワークスペースを、もっと便利に。</p><h1>拡張機能</h1><p>使いたい機能を選んで追加すると、このワークスペースから利用できます。</p></header>
      <WorkspaceExtensions slug={slug} presentation="page" />
    </div>
  </main>;
}
