import { lllmAccess } from "@/lib/lllm-relay";
import { issueLllmLaunch } from "@/lib/lllm-browser-authorization";
import { relayJson } from "@/lib/lllm-policy";
import { validateSameOriginJson } from "@/lib/request-security";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!validateSameOriginJson(request, "lllm-launch")) return relayJson({ error: "安全確認に失敗しました" }, 403);
  const { slug } = await params;
  const auth = await lllmAccess(slug);
  if (!auth.ok) return auth.response;
  try {
    const launch = await issueLllmLaunch(auth.membership.workspace_id, auth.user.accountKey, auth.membership.slug);
    return launch ? relayJson(launch, 201) : relayJson({ error: "起動の受付が混み合っているか、利用権限が変更されました。少し待ってからワークスペースで開き直してください。" }, 429);
  } catch { return relayJson({ error: "起動を準備できませんでした。ワークスペースで、もう一度お試しください。" }, 503); }
}
