import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { lllmAccess } from "@/lib/lllm-relay";
import { LLLM_HTML } from "@/lib/lllm-html";
import { privateHeaders } from "@/lib/lllm-policy";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireChatGPTUser(`/apps/lllm/${encodeURIComponent(slug)}`);
  const auth = await lllmAccess(slug);
  if (!auth.ok) return auth.response;
  return new Response(LLLM_HTML.replace("__LLLM_WORKSPACE__", encodeURIComponent(slug)), {
    headers: { ...privateHeaders, "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "clear-site-data": '"cache"',
    },
  });
}
