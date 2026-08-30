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
import { authorizeApplicationUser } from "@/lib/application-access";
import { listWorkspaces } from "@/lib/db";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await getChatGPTUser();
  if (!user)
    return <LoginLanding signInPath={chatGPTSignInPath("/")} />;
  const authorizedUser = await authorizeApplicationUser(user);
  if (!authorizedUser.ok)
    return (
      <AccessDeniedLanding
        signOutPath={chatGPTSignOutPath("/")}
        diagnostics={authorizedUser.diagnostics}
      />
    );
  const initialWorkspaces = await listWorkspaces(authorizedUser.user.email);
  return (
    <DashboardClient
      user={authorizedUser.user}
      signOutPath={chatGPTSignOutPath("/")}
      initialWorkspaces={initialWorkspaces}
    />
  );
}
