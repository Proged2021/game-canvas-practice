import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { oauthConfig, publicConfluenceStatus } from "@/lib/confluence";
import { buildAtlassianAuthorizeUrl } from "@/lib/confluence-safe";

function secureState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const auth = await authorizeWorkspace(slug, ["owner"]);
  if (!auth.ok) return auth.response;
  const publicStatus = publicConfluenceStatus(false);
  if (!publicStatus.configured)
    return Response.json({ error: "Confluence連携は未設定です", ...publicStatus }, { status: 503 });
  try {
    const { clientId, redirectUri } = oauthConfig();
    const state = secureState();
    const requestedSceneId = new URL(request.url).searchParams.get("sceneId") ?? "";
    const scene = /^[A-Za-z0-9_-]{1,128}$/.test(requestedSceneId)
      ? await db().prepare("SELECT id FROM scenes WHERE id=?1 AND workspace_id=?2")
          .bind(requestedSceneId, auth.membership.workspace_id).first<{ id: string }>()
      : null;
    const expires = new Date(Date.now() + 10 * 60_000).toISOString();
    await db().prepare("DELETE FROM oauth_states WHERE expires_at < CURRENT_TIMESTAMP").run();
    await db().prepare("INSERT INTO oauth_states (state, workspace_id, user_email, scene_id, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(state, auth.membership.workspace_id, auth.user.accountKey, scene?.id ?? null, expires).run();
    const url = buildAtlassianAuthorizeUrl(clientId, redirectUri, state);
    return Response.redirect(url.toString(), 302);
  } catch {
    return Response.json({ error: "Confluence接続の準備中に問題が発生しました", ...publicStatus }, { status: 500 });
  }
}
