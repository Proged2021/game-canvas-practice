const message = "作業のため一時停止しています。再開までお待ちください。";
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>一時停止中 | game-canvas</title></head><body><main><h1>一時停止中</h1><p>${message}</p></main></body></html>`;

/** Does not read authentication, storage, or any application bindings. */
export function siteMaintenanceResponse(request: Request) {
  const isApi = /^\/api(?:\/|$)/.test(new URL(request.url).pathname);
  const isJson = isApi || !["GET", "HEAD"].includes(request.method);
  const headers = {
    "content-type": isJson ? "application/json; charset=utf-8" : "text/html; charset=utf-8",
    "cache-control": "private, no-store, no-cache, max-age=0, must-revalidate",
    "retry-after": "120",
    "x-robots-tag": "noindex, nofollow, noarchive",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  };
  const body = request.method === "HEAD" ? null
    : isJson ? JSON.stringify({ error: message, code: "SITE_MAINTENANCE" }) : html;
  return new Response(body, { status: 503, headers });
}
