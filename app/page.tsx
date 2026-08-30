import { requireChatGPTUser, chatGPTSignOutPath } from "@/app/chatgpt-auth";
import { DashboardClient } from "@/components/dashboard-client";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await requireChatGPTUser("/");
  return <DashboardClient user={user} signOutPath={chatGPTSignOutPath("/")} />;
}
