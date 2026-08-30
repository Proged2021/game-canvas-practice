import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const auth = await authorizeWorkspace(slug);
  if ("response" in auth) return auth.response;
  const [scenes, members, connection] = await Promise.all([
    db().prepare("SELECT id, title, markdown, position, revision, updated_by, updated_at FROM scenes WHERE workspace_id = ?1 ORDER BY position, created_at").bind(auth.membership.workspace_id).all(),
    db().prepare("SELECT email, role, invited_by, created_at FROM members WHERE workspace_id = ?1 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, email").bind(auth.membership.workspace_id).all(),
    db().prepare(`SELECT cloud_url, page_id, page_url, page_title, page_version, synced_html,
      last_synced_at, last_checked_at, last_error,
      CASE WHEN access_token_ciphertext IS NOT NULL THEN 1 ELSE 0 END AS connected
      FROM confluence_connections WHERE workspace_id = ?1`).bind(auth.membership.workspace_id).first(),
  ]);
  return Response.json({
    workspace: { slug, name: auth.membership.name, role: auth.membership.role },
    currentUser: { email: auth.user.email, displayName: auth.user.displayName },
    scenes: scenes.results, members: members.results, confluence: connection ?? null,
  });
}
