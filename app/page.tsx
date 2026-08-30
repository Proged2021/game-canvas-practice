import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
} from "@/app/chatgpt-auth";
import { DashboardClient } from "@/components/dashboard-client";
import { LoginLanding } from "@/components/login-landing";
import { listWorkspaces } from "@/lib/db";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await getChatGPTUser();
  if (!user)
    return <LoginLanding signInPath={chatGPTSignInPath("/")} />;
  const initialWorkspaces = await listWorkspaces(user.email);
  return (
    <DashboardClient
      user={user}
      signOutPath={chatGPTSignOutPath("/")}
      initialWorkspaces={initialWorkspaces}
    />
  );
}
