import { notFound } from "next/navigation";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { principalForUser } from "@/lib/account-principal";
import { getMembership } from "@/lib/db";
import { WorkspaceExtensions } from "@/components/workspace-extensions";

export const dynamic = "force-dynamic";

export default async function ExtensionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const identity = await requireChatGPTUser(`/w/${encodeURIComponent(slug)}/extensions`);
  const user = await principalForUser(identity);
  const membership = await getMembership(slug, user.accountKey);
  if (!membership) notFound();
  return <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-12">
    <a href={`/w/${encodeURIComponent(slug)}`} className="text-sm underline">← ワークスペースへ戻る</a>
    <header><p className="text-sm text-muted-foreground">{membership.name}</p><h1 className="text-3xl font-semibold">拡張機能</h1></header>
    <p>このワークスペースのメンバーが使うアプリを選べます。追加・停止はオーナーが行います。</p>
    <div><WorkspaceExtensions slug={slug} initiallyOpen /></div>
  </main>;
}
