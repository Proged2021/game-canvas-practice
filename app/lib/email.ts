import { env } from "cloudflare:workers";

// メール送信用の設定を読み込む
 declare global {
  namespace Cloudflare {
    interface Env {
      RESEND_API_KEY: string;
      EMAIL_FROM: string;
    }
  }
}

type EmailInput = {
  to: string;
  subject: string;
  text: string;
};

// Resendへメールの送信を依頼する
export async function sendEmail({ to, subject, text }: EmailInput) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;

  if (!apiKey || !from) {
    throw new Error("メール送信の設定が不足しています。");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  // 送信依頼が受け付けられなかった場合は中断する
  if (!response.ok) {
    throw new Error(`メール送信の依頼に失敗しました（${response.status}）。`);
  }

  // 送信依頼の受付番号を確認する
  const result: unknown = await response.json();

  if (
    typeof result !== "object" ||
    result === null ||
    !("id" in result) ||
    typeof result.id !== "string"
  ) {
    throw new Error("メール送信の受付結果を確認できませんでした。");
  }

  return result.id;
}