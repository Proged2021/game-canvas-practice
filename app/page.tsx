import type { Metadata } from "next";
import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
} from "@/app/chatgpt-auth";
import { DashboardClient } from "@/components/dashboard-client";
import { LoginLanding } from "@/components/login-landing";
import { principalForUser } from "@/lib/account-principal";
import { listWorkspaces } from "@/lib/db";
import { PUBLIC_SITE_DESCRIPTION, PUBLIC_SITE_ORIGIN, PUBLIC_SITE_TITLE } from "@/lib/public-discovery";

export const metadata: Metadata = {
  title: PUBLIC_SITE_TITLE,
  description: PUBLIC_SITE_DESCRIPTION,
  alternates: { canonical: `${PUBLIC_SITE_ORIGIN}/` },
  robots: { index: true, follow: true },
};

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
