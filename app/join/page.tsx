import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { principalForUser } from "@/lib/account-principal";
import { JoinClient } from "@/components/join-client";

export const dynamic = "force-dynamic";

export default async function JoinPage() {
  const identity = await requireChatGPTUser("/join");
  await principalForUser(identity);
  return <JoinClient />;
}
