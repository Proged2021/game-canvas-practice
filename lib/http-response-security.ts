export function applicationResponseHeaders(pathname: string, initial: HeadersInit): Headers {
  const headers = new Headers(initial);
  // Routing decodes URL segments. Apply the privacy policy to encoded aliases
  // as well; this normalization never changes the URL used to dispatch a route.
  let policyPath: string;
  try { policyPath = decodeURIComponent(pathname); }
  catch { policyPath = "/api/invalid-path"; }
  headers.set("x-content-type-options", "nosniff");
  if (!headers.has("referrer-policy")) headers.set("referrer-policy", "strict-origin-when-cross-origin");
  const contentType = (headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  const accountContent = ["text/html", "application/json", "text/x-component"].includes(contentType) || headers.has("set-cookie");
  const privatePage = accountContent || policyPath === "/" || /^\/(?:w|api|apps)(?:\/|$)/.test(policyPath);
  const privateExtension = policyPath.includes("/extensions") || policyPath.startsWith("/lllm-assets/");
  if (privatePage || privateExtension) {
    headers.set("cache-control", "private, no-store, no-cache, max-age=0, must-revalidate");
    headers.set("pragma", "no-cache");
    headers.set("expires", "0");
    headers.delete("etag");
    headers.delete("last-modified");
  }
  if (policyPath.startsWith("/apps/lllm/") || policyPath.startsWith("/api/lllm-connector") || privateExtension) {
    headers.set("referrer-policy", "no-referrer");
  }
  return headers;
}
