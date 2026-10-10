import type { BetterAuthOptions } from "better-auth";

// メール確認が完了するまでログインを許可しない
export const authOptions = {
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    autoSignIn: false,
    revokeSessionsOnPasswordReset: true,
  },

  // 登録時に、有効期限1時間の確認メールを送る
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: false,
    autoSignInAfterVerification: false,
    expiresIn: 60 * 60,
  },

  // 認証APIへの連続アクセスを制限する
  rateLimit: {
    enabled: true,
    storage: "database",
  },
} satisfies BetterAuthOptions;