import { env } from "cloudflare:workers";
import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { oauthConfig } from "@/lib/confluence";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const auth = await authorizeWorkspace(slug, ["owner"]);
  if (!auth.ok) return auth.response;
  try {
    const origin = new URL(request.url).origin;
    const { clientId, redirectUri } = oauthConfig(origin);
    const state = crypto.randomUUID();
    const expires = new Date(Date.now() + 10 * 60_000).toISOString();
    await db().prepare("DELETE FROM oauth_states WHERE expires_at < CURRENT_TIMESTAMP").run();
    await db().prepare("INSERT INTO oauth_states (state, workspace_id, user_email, expires_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(state, auth.membership.workspace_id, auth.user.email, expires).run();
    const url = new URL("https://auth.atlassian.com/authorize");
    url.search = new URLSearchParams({ audience: "api.atlassian.com", client_id: clientId, scope: "read:page:confluence offline_access", redirect_uri: redirectUri, state, response_type: "code", prompt: "consent" }).toString();
    return Response.json({ url: url.toString() });
  } catch (error) {
    const configured = Boolean(env.ATLASSIAN_CLIENT_ID && env.ATLASSIAN_CLIENT_SECRET && env.TOKEN_ENCRYPTION_KEY);
    return Response.json({ error: error instanceof Error ? error.message : "Confluence接続を開始できません", configured }, { status: 503 });
  }
}
