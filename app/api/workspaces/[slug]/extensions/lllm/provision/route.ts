import { authorizeWorkspace } from "@/lib/auth";
import { provisionLegacyLllm } from "@/lib/lllm-provisioning";
import { privateHeaders, relayJson } from "@/lib/lllm-policy";
import { validateSameOriginJson } from "@/lib/request-security";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!validateSameOriginJson(request, "lllm-provision")) return relayJson({ error: "安全確認に失敗しました" }, 403);
  const { slug } = await params;
  const auth = await authorizeWorkspace(slug, ["owner"]);
  if (!auth.ok) {
    const headers = new Headers(auth.response.headers);
    for (const [name, value] of Object.entries(privateHeaders)) headers.set(name, value);
    return new Response(auth.response.body, { status: auth.response.status, headers });
  }
  try {
    const result = await provisionLegacyLllm(auth.membership.workspace_id, auth.user.accountKey);
    return result.ok ? relayJson(result) : relayJson({ error: result.error }, result.status);
  } catch { return relayJson({ error: "設定を引き継げませんでした。画面を更新して、もう一度お試しください。" }, 503); }
}
