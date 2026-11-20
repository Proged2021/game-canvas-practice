import { LLLM_ASSETS } from "@/lib/lllm-assets";
import { privateHeaders } from "@/lib/lllm-policy";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;
  if (!Object.hasOwn(LLLM_ASSETS, asset)) return new Response("Not found", { status: 404, headers: privateHeaders });
  return new Response(LLLM_ASSETS[asset], { headers: {
    ...privateHeaders,
    "content-type": asset.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8",
  } });
}
