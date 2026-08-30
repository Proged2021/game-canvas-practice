import sanitizeHtml from "sanitize-html";

export function buildAtlassianAuthorizeUrl(clientId: string, redirectUri: string, state: string) {
  const url = new URL("https://auth.atlassian.com/authorize");
  url.search = new URLSearchParams({
    audience: "api.atlassian.com",
    client_id: clientId,
    scope: "read:page:confluence offline_access",
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    prompt: "consent",
  }).toString();
  return url;
}

export function parseConfluencePage(input: string) {
  const trimmed = input.trim();
  if (/^\d{1,30}$/.test(trimmed)) return { pageId: trimmed, originalUrl: null };
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.endsWith(".atlassian.net") || !url.pathname.startsWith("/wiki/")) return null;
    const match = url.pathname.match(/\/pages\/(\d{1,30})(?:\/|$)/) ?? url.search.match(/[?&]pageId=(\d{1,30})(?:&|$)/);
    return match ? { pageId: match[1], originalUrl: url.toString() } : null;
  } catch { return null; }
}

export function extractPageId(input: string) { return parseConfluencePage(input)?.pageId ?? null; }

function absolute(value: string, base: string, image = false) {
  try {
    const url = new URL(value, base);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
    if (!image && url.protocol === "mailto:") return url.toString();
    return "";
  } catch { return ""; }
}

export function sanitizeConfluenceHtml(html: string, baseUrl: string) {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "figure", "figcaption", "details", "summary", "time", "mark", "thead", "tbody", "tfoot"]),
    allowedAttributes: {
      "*": ["class", "title", "data-layout", "data-local-id"],
      a: ["href", "name", "target", "rel", "class", "title"],
      img: ["src", "alt", "title", "width", "height", "class", "loading"],
      td: ["colspan", "rowspan"], th: ["colspan", "rowspan", "scope"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    disallowedTagsMode: "discard",
    transformTags: {
      a: (_tag, attrs) => ({ tagName: "a", attribs: { ...attrs, href: absolute(attrs.href ?? "", baseUrl), target: "_blank", rel: "noopener noreferrer" } }),
      img: (_tag, attrs) => ({ tagName: "img", attribs: { ...attrs, src: absolute(attrs.src ?? "", baseUrl, true), loading: "lazy" } }),
    },
  });
}

export function atlassianError(status: number) {
  if (status === 401) return "Confluenceの再認証が必要です";
  if (status === 403) return "Confluenceページを読む権限がありません";
  if (status === 404) return "指定したConfluenceページが見つかりません";
  if (status === 429) return "Confluenceの利用上限に達しました。しばらくして再試行してください";
  if (status >= 500) return "Atlassian側で障害が発生しています。時間をおいて再試行してください";
  return "Confluenceページを取得できませんでした";
}
