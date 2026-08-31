import { notFound } from "next/navigation";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { principalForUser } from "@/lib/account-principal";
import { getMembership, loadWorkspaceData } from "@/lib/db";
import { WorkspaceClient } from "@/components/workspace-client";
import { cleanupExpiredScenes } from "@/lib/scene-deletion";
export const dynamic = "force-dynamic";
export default async function WorkspacePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ scene?: string }> }) {
  const { slug } = await params;
  const identity = await requireChatGPTUser(`/w/${slug}`);
  const user = await principalForUser(identity);
  const membership = await getMembership(slug, user.accountKey);
  if (!membership) notFound();
  await cleanupExpiredScenes(membership.workspace_id);
  const initialData = await loadWorkspaceData(membership);
  const requestedScene = (await searchParams).scene;
  const initialSceneId = requestedScene && initialData.scenes.some((scene) => scene.id === requestedScene)
    ? requestedScene
    : undefined;
  return <WorkspaceClient slug={slug} initialData={initialData} initialSceneId={initialSceneId} />;
}
