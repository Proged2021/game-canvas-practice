import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
} from "@/app/chatgpt-auth";
import { DashboardClient } from "@/components/dashboard-client";
import { LoginLanding } from "@/components/login-landing";
import { principalForUser } from "@/lib/account-principal";
import { listWorkspaces } from "@/lib/db";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await getChatGPTUser();
  if (!user)
    return <LoginLanding signInPath={chatGPTSignInPath("/")} />;
  const principal = await principalForUser(user);
  const initialWorkspaces = await listWorkspaces(principal.accountKey);
  return (
    <DashboardClient
      signOutPath={chatGPTSignOutPath("/")}
      initialWorkspaces={initialWorkspaces}
    />
  );
}
