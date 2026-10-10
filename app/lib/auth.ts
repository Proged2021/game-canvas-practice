import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "@/app/db";
import * as authSchema from "@/app/db/auth-schema";
import { authOptions } from "./auth-options";

// 認証に使う環境設定の型を定義する
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

    // 認証データをDrizzle経由でD1に保存する
    database: drizzleAdapter(getDb(), {
      provider: "sqlite",
      schema: authSchema,
      transaction: false,
    }),
  });
}