import { notFound } from "next/navigation";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { hasApplicationAccess } from "@/lib/application-access";
import { getMembership, loadWorkspaceData } from "@/lib/db";
import { WorkspaceClient } from "@/components/workspace-client";
export const dynamic = "force-dynamic";
export default async function WorkspacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireChatGPTUser(`/w/${slug}`);
  if (!(await hasApplicationAccess(user.email))) notFound();
  const membership = await getMembership(slug, user.email);
  if (!membership) notFound();
  const initialData = await loadWorkspaceData(membership, user);
  return <WorkspaceClient slug={slug} initialData={initialData} />;
}
