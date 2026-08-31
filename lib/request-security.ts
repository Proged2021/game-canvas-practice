export function validateSameOriginJson(request: Request, csrfValue: string) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  return origin === new URL(request.url).origin
    && (!fetchSite || fetchSite === "same-origin")
    && contentType.startsWith("application/json")
    && request.headers.get("x-plotline-csrf") === csrfValue;
}
