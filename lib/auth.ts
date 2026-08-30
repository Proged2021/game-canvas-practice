import { getChatGPTUser } from "@/app/chatgpt-auth";
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
  return { ok: true, user } as const;
}

export async function authorizeWorkspace(slug: string, allowed?: Role[]) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth;
  const membership = await getMembership(slug, auth.user.email);
  if (!membership)
    return {
      ok: false,
      response: Response.json(
        { error: "このワークスペースへの招待がありません" },
        { status: 403 },
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
