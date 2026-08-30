import type { ChatGPTUser } from "@/lib/chatgpt-identity";
import { maskEmail } from "@/lib/access-policy";
import { PLOTLINE_RUNTIME_VERSION } from "@/lib/runtime-version";

export type AccessDiagnostics = {
  emailClaimPresent: boolean;
  maskedEmail: string;
  userIdClaimPresent: boolean;
  userIdHashPrefix: string | null;
  reasonCode: "NO_MATCHING_APP_MEMBERSHIP";
  runtimeVersion: string;
};

export async function buildAccessDiagnostics(
  user: ChatGPTUser,
): Promise<AccessDiagnostics> {
  return {
    emailClaimPresent: Boolean(user.email),
    maskedEmail: maskEmail(user.email),
    userIdClaimPresent: Boolean(user.userId),
    userIdHashPrefix: user.userId ? await sha256Prefix(user.userId) : null,
    reasonCode: "NO_MATCHING_APP_MEMBERSHIP",
    runtimeVersion: PLOTLINE_RUNTIME_VERSION,
  };
}

async function sha256Prefix(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest).slice(0, 6), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
