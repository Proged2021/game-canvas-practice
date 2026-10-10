import { loadEnvFile } from "node:process";
import { betterAuth } from "better-auth";
import { authOptions } from "./app/lib/auth-options";

// テーブル生成時にローカルの認証設定を読み込む
loadEnvFile(".dev.vars");

const secret = process.env.BETTER_AUTH_SECRET;
const baseURL = process.env.BETTER_AUTH_URL;

// 設定が不足していたら生成を止める
if (!secret || !baseURL) {
  throw new Error(".dev.vars の認証設定が不足しています。");
}

// テーブル生成専用の設定。アプリの実行時には使わない
export const auth = betterAuth({
  ...authOptions,
  secret,
  baseURL,
});