import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
} from "@/app/chatgpt-auth";
import { DashboardClient } from "@/components/dashboard-client";
import {
  AccessDeniedLanding,
  LoginLanding,
} from "@/components/login-landing";
import { hasApplicationAccess } from "@/lib/application-access";
import { listWorkspaces } from "@/lib/db";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await getChatGPTUser();
  if (!user)
    return <LoginLanding signInPath={chatGPTSignInPath("/")} />;
  if (!(await hasApplicationAccess(user.email)))
    return <AccessDeniedLanding signOutPath={chatGPTSignOutPath("/")} />;
  const initialWorkspaces = await listWorkspaces(user.email);
  return (
    <DashboardClient
      user={user}
      signOutPath={chatGPTSignOutPath("/")}
      initialWorkspaces={initialWorkspaces}
    />
  );
}
