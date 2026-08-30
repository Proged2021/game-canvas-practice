import { notFound } from "next/navigation";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import {
  authorizeApplicationUser,
  resolveWorkspaceMembership,
} from "@/lib/application-access";
import { loadWorkspaceData } from "@/lib/db";
import { WorkspaceClient } from "@/components/workspace-client";
export const dynamic = "force-dynamic";
export default async function WorkspacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const identity = await requireChatGPTUser(`/w/${slug}`);
  const authorization = await authorizeApplicationUser(identity);
  if (!authorization.ok) notFound();
  const user = authorization.user;
  const membership = await resolveWorkspaceMembership(slug, user);
  if (!membership) notFound();
  const initialData = await loadWorkspaceData(membership, user);
  return <WorkspaceClient slug={slug} initialData={initialData} />;
}
