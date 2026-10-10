import { env, waitUntil } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "@/app/db";
import * as authSchema from "@/app/db/auth-schema";
import { authOptions } from "./auth-options";
import { sendEmail } from "./email";

// 認証に使う環境設定を読み込む
 declare global {
  namespace Cloudflare {
    interface Env {
      BETTER_AUTH_SECRET: string;
      BETTER_AUTH_URL: string;
    }
  }
}

// リクエストの処理中に認証機能を準備する
export function getAuth() {
  const secret = env.BETTER_AUTH_SECRET;
  const baseURL = env.BETTER_AUTH_URL;

  // 必要な設定がなければ処理を止める
  if (!secret || secret.length < 32 || !baseURL) {
    throw new Error("認証の環境設定を確認してください。");
  }

  return betterAuth({
    ...authOptions,
    secret,
    baseURL,
    trustedOrigins: [baseURL],

    // 認証データをD1に保存する
    database: drizzleAdapter(getDb(), {
      provider: "sqlite",
      schema: authSchema,
      transaction: false,
    }),

    emailVerification: {
      ...authOptions.emailVerification,

      // メールアドレスの確認リンクを送る
      sendVerificationEmail: async ({ user, url }) => {
        waitUntil(
          sendEmail({
            to: user.email,
            subject: "【Game-Canvas】メールアドレスを確認してください",
            text: [
              "Game-Canvasへの登録を受け付けました。",
              "次のリンクを開いて、メールアドレスを確認してください。",
              "",
              url,
              "",
              "リンクの有効期限は1時間です。",
              "心当たりがない場合は、リンクを開かずにこのメールを破棄してください。",
            ].join("\n"),
          }).catch(() => {
            // 秘密のリンクや個人情報はログに残さない
            console.error("確認メールの送信処理に失敗しました。Resendのログを確認してください。");
          })
        );
      },

      // メール確認が済んだユーザーへ登録完了を知らせる
      afterEmailVerification: async (user) => {
        waitUntil(
          sendEmail({
            to: user.email,
            subject: "【Game-Canvas】登録が完了しました",
            text: [
              "メールアドレスの確認が完了しました。",
              "Game-Canvasにログインしてご利用いただけます。",
              "",
              `ログイン画面：${baseURL}/`,
              "",
              "このメールにパスワードは記載していません。",
            ].join("\n"),
          }).catch(() => {
            console.error("登録完了メールの送信処理に失敗しました。Resendのログを確認してください。");
          })
        );
      },
    },
  });
}