import { authorizeWorkspace } from "@/lib/auth";
import { hasConfluenceConnection, publicConfluenceStatus } from "@/lib/confluence";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await authorizeWorkspace((await params).slug);
  if (!auth.ok) return auth.response;
  const connected = await hasConfluenceConnection(auth.membership.workspace_id);
  return Response.json(publicConfluenceStatus(connected));
}
