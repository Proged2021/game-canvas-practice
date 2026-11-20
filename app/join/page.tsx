//招待からワークスペースへの参加を申請する画面の入口を作る。

import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { principalForUser } from "@/lib/account-principal";
import { JoinClient } from "@/components/join-client";

export const dynamic = "force-dynamic";

export default async function JoinPage() {
  // ログインを確認し、利用者情報を受け取る。
  const identity = await requireChatGPTUser("/join");
  // アプリ内のアカウント情報に必要な準備が終わるまで待つ。
  await principalForUser(identity);
  // 参加申請の操作画面を表示する。
  return <JoinClient />;
}
