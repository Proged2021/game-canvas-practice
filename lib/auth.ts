import { getChatGPTUser } from "@/app/chatgpt-auth";
import { principalForUser } from "@/lib/account-principal";
import { getMembership, type Role } from "@/lib/db";

export async function requireApiUser() {
  const user = await getChatGPTUser();
  if (!user)
    return {
      ok: false,
      response: Response.json(
        { error: "ChatGPTへのログインが必要です" },
        { status: 401 },
      ),
    } as const;
  const principal = await principalForUser(user);
  return { ok: true, user: principal } as const;
}

export async function authorizeWorkspace(slug: string, allowed?: Role[]) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth;
  const membership = await getMembership(slug, auth.user.accountKey);
  if (!membership)
    return {
      ok: false,
      response: Response.json(
        { error: "ワークスペースが見つかりません" },
        { status: 404, headers: { "cache-control": "no-store" } },
      ),
    } as const;
  if (allowed && !allowed.includes(membership.role)) {
    return {
      ok: false,
      response: Response.json(
        { error: "この操作を行う権限がありません" },
        { status: 403 },
      ),
    } as const;
  }
  return { ok: true, user: auth.user, membership } as const;
}
