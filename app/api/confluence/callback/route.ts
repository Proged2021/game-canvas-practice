import { getChatGPTUser } from "@/app/chatgpt-auth";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { exchangeCode } from "@/lib/confluence";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const user = await getChatGPTUser();
  if (!code || !state || !user) return new Response("Invalid OAuth callback", { status: 400 });
  const record = await db().prepare(`SELECT s.workspace_id, s.user_email, w.slug FROM oauth_states s
    JOIN workspaces w ON w.id=s.workspace_id WHERE s.state=?1 AND s.expires_at > CURRENT_TIMESTAMP`).bind(state).first<{ workspace_id: string; user_email: string; slug: string }>();
  if (!record || record.user_email.toLowerCase() !== user.email.toLowerCase()) return new Response("OAuth state validation failed", { status: 403 });
  try {
    const token = await exchangeCode(code, url.origin);
    const resourcesResponse = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", { headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" } });
    if (!resourcesResponse.ok) throw new Error("Atlassian site lookup failed");
    const resources = await resourcesResponse.json() as Array<{ id: string; url: string; name: string; scopes: string[] }>;
    const resource = resources.find(item => item.scopes.some(scope => scope.includes("confluence"))) ?? resources[0];
    if (!resource) throw new Error("利用可能なConfluenceサイトがありません");
    await db().prepare(`INSERT INTO confluence_connections
      (workspace_id, cloud_id, cloud_url, access_token_ciphertext, refresh_token_ciphertext, token_expires_at, updated_by)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
      ON CONFLICT(workspace_id) DO UPDATE SET cloud_id=excluded.cloud_id, cloud_url=excluded.cloud_url,
      access_token_ciphertext=excluded.access_token_ciphertext, refresh_token_ciphertext=excluded.refresh_token_ciphertext,
      token_expires_at=excluded.token_expires_at, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`)
      .bind(record.workspace_id, resource.id, resource.url, await encrypt(token.access_token), token.refresh_token ? await encrypt(token.refresh_token) : null, new Date(Date.now() + token.expires_in * 1000).toISOString(), user.email).run();
    await db().prepare("DELETE FROM oauth_states WHERE state=?1").bind(state).run();
    return Response.redirect(`${url.origin}/w/${record.slug}?confluence=connected`, 302);
  } catch (error) {
    return Response.redirect(`${url.origin}/w/${record.slug}?confluence=error&message=${encodeURIComponent(error instanceof Error ? error.message : "接続失敗")}`, 302);
  }
}
