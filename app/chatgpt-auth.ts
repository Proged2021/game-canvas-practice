//サーバー側でログイン利用者を取得し、ログインやログアウトの入口を用意する

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  chatGPTSignInPath,
  parseChatGPTUserHeaders,
  type ChatGPTUser,
} from "@/lib/chatgpt-identity";

export {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  parseChatGPTUserHeaders,
} from "@/lib/chatgpt-identity";
export type { ChatGPTUser } from "@/lib/chatgpt-identity";

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  return parseChatGPTUserHeaders(await headers());
}

export async function requireChatGPTUser(
  returnTo: string,
): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;

  redirect(chatGPTSignInPath(returnTo));
}
