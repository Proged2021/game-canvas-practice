import type { BetterAuthOptions } from "better-auth";

// 認証処理とテーブル生成で共通の設定を使う
export const authOptions = {
  emailAndPassword: {
    enabled: true,
    revokeSessionsOnPasswordReset: true,
  },
  rateLimit: {
    enabled: true,
    storage: "database",
  },
} satisfies BetterAuthOptions;