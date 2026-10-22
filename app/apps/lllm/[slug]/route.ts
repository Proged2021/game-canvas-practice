import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { lllmAccess } from "@/lib/lllm-relay";
import { lllmPage } from "@/lib/lllm-page";
import { lllmAccessPage } from "@/lib/lllm-access-page";
import { privateHeaders } from "@/lib/lllm-policy";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireChatGPTUser(`/apps/lllm/${encodeURIComponent(slug)}`);
  const auth = await lllmAccess(slug);
  if (!auth.ok) {
    const result = await auth.response.json().catch(() => null) as { error?: unknown } | null;
    const message = typeof result?.error === "string" ? result.error : "このLLLMを利用する権限を確認できませんでした。";
    return new Response(lllmAccessPage(message), {
      status: auth.response.status,
      headers: { ...privateHeaders, "content-type": "text/html; charset=utf-8",
        "content-security-policy": "default-src 'none'; script-src 'none'; style-src 'none'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        "permissions-policy": "camera=(), microphone=(), geolocation=()",
        "clear-site-data": '"cache"',
      },
    });
  }
  return new Response(lllmPage(slug, auth.membership.name), {
    headers: { ...privateHeaders, "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "clear-site-data": '"cache"',
    },
  });
}
