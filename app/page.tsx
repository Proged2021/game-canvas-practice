import { requireChatGPTUser, chatGPTSignOutPath } from "@/app/chatgpt-auth";
import { DashboardClient } from "@/components/dashboard-client";
import { listWorkspaces } from "@/lib/db";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await requireChatGPTUser("/");
  const initialWorkspaces = await listWorkspaces(user.email);
  return (
    <DashboardClient
      user={user}
      signOutPath={chatGPTSignOutPath("/")}
      initialWorkspaces={initialWorkspaces}
    />
  );
}
