import { lllmAccess } from "@/lib/lllm-relay";
import { lllmPage } from "@/lib/lllm-page";
import { privateHeaders } from "@/lib/lllm-policy";
import { browserNotFound, consumeLllmLaunch } from "@/lib/lllm-browser-authorization";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const launches = new URL(request.url).searchParams.getAll("launch");
  if (launches.length !== 1 || !/^[a-f0-9]{64}$/.test(launches[0])) return browserNotFound();
  const auth = await lllmAccess(slug);
  if (!auth.ok) return browserNotFound();
  let sessionToken: string | null;
  try { sessionToken = await consumeLllmLaunch(launches[0], auth.membership.workspace_id, auth.user.accountKey); }
  catch { return browserNotFound(); }
  if (!sessionToken) return browserNotFound();
  return new Response(lllmPage(slug, auth.membership.name, sessionToken), {
    headers: { ...privateHeaders, "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "clear-site-data": '"cache"',
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}
