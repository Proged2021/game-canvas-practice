import { notFound } from "next/navigation";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { getMembership } from "@/lib/db";
import { WorkspaceClient } from "@/components/workspace-client";
export const dynamic = "force-dynamic";
export default async function WorkspacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireChatGPTUser(`/w/${slug}`);
  if (!await getMembership(slug, user.email)) notFound();
  return <WorkspaceClient slug={slug} />;
}
