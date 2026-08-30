import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { CONFLUENCE_SCOPES, oauthConfig, publicConfluenceStatus } from "@/lib/confluence";

function secureState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const auth = await authorizeWorkspace(slug, ["owner"]);
  if (!auth.ok) return auth.response;
  const publicStatus = publicConfluenceStatus(false);
  if (!publicStatus.configured)
    return Response.json({ error: "Confluence連携は未設定です", ...publicStatus }, { status: 503 });
  try {
    const { clientId, redirectUri } = oauthConfig();
    const state = secureState();
    const expires = new Date(Date.now() + 10 * 60_000).toISOString();
    await db().prepare("DELETE FROM oauth_states WHERE expires_at < CURRENT_TIMESTAMP").run();
    await db().prepare("INSERT INTO oauth_states (state, workspace_id, user_email, expires_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(state, auth.membership.workspace_id, auth.user.email, expires).run();
    const url = new URL("https://auth.atlassian.com/authorize");
    url.search = new URLSearchParams({ audience: "api.atlassian.com", client_id: clientId, scope: CONFLUENCE_SCOPES, redirect_uri: redirectUri, state, response_type: "code", prompt: "consent" }).toString();
    return Response.json({ url: url.toString() });
  } catch {
    return Response.json({ error: "Confluence接続の準備中に問題が発生しました", ...publicStatus }, { status: 500 });
  }
}
