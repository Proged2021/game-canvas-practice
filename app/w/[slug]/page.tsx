import { notFound } from "next/navigation";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { principalForUser } from "@/lib/account-principal";
import { getMembership, loadWorkspaceData } from "@/lib/db";
import { WorkspaceClient } from "@/components/workspace-client";
export const dynamic = "force-dynamic";
export default async function WorkspacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const identity = await requireChatGPTUser(`/w/${slug}`);
  const user = await principalForUser(identity);
  const membership = await getMembership(slug, user.accountKey);
  if (!membership) notFound();
  const initialData = await loadWorkspaceData(membership);
  return <WorkspaceClient slug={slug} initialData={initialData} />;
}
