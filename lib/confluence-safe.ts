import sanitizeHtml from "sanitize-html";

export function buildAtlassianAuthorizeUrl(clientId: string, redirectUri: string, state: string) {
  const url = new URL("https://auth.atlassian.com/authorize");
  url.search = new URLSearchParams({
    audience: "api.atlassian.com",
    client_id: clientId,
    scope: "read:page:confluence read:attachment:confluence offline_access",
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    prompt: "consent",
  }).toString();
  return url;
}

export type ParsedConfluencePage = {
  pageId: string | null;
  originalUrl: string | null;
  shortUrl: string | null;
};

function isAtlassianCloudHost(hostname: string) {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+atlassian\.net$/i.test(hostname);
}

export function parseConfluencePage(input: string): ParsedConfluencePage | null {
  const trimmed = input.trim();
  if (/^\d{1,30}$/.test(trimmed)) return { pageId: trimmed, originalUrl: null, shortUrl: null };
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !isAtlassianCloudHost(url.hostname)) return null;
    let pathname: string;
    try { pathname = decodeURIComponent(url.pathname); } catch { return null; }
    const pathMatch = pathname.match(/\/(?:wiki\/)?spaces\/[^/]+\/pages\/(\d{1,30})(?:\/|$)/i)
      ?? pathname.match(/\/(?:wiki\/)?pages\/(\d{1,30})(?:\/|$)/i);
    const queryId = url.searchParams.get("pageId") ?? url.searchParams.get("homepageId");
    const pageId = pathMatch?.[1] ?? (queryId && /^\d{1,30}$/.test(queryId) ? queryId : null);
    if (pageId) return { pageId, originalUrl: url.toString(), shortUrl: null };
    if (/^\/(?:wiki\/)?x\/[A-Za-z0-9_-]{1,128}\/?$/i.test(pathname))
      return { pageId: null, originalUrl: url.toString(), shortUrl: url.toString() };
    return null;
  } catch { return null; }
}

export function extractPageId(input: string) { return parseConfluencePage(input)?.pageId ?? null; }

export async function resolveConfluenceShortUrl(
  shortUrl: string,
  allowedCloudUrl: string,
  fetcher: typeof fetch = fetch,
) {
  const allowedHost = new URL(allowedCloudUrl).hostname;
  let current = new URL(shortUrl);
  if (!isAtlassianCloudHost(current.hostname) || current.hostname !== allowedHost)
    throw new Error("SHORT_LINK_SITE_MISMATCH");

  for (let hop = 0; hop < 5; hop += 1) {
    const parsed = parseConfluencePage(current.toString());
    if (parsed?.pageId) return { pageId: parsed.pageId, originalUrl: shortUrl };
    const response = await fetcher(current.toString(), {
      method: "GET",
      redirect: "manual",
      headers: { accept: "text/html" },
    });
    if (response.status < 300 || response.status >= 400) throw new Error("SHORT_LINK_UNRESOLVED");
    const location = response.headers.get("location");
    if (!location) throw new Error("SHORT_LINK_UNRESOLVED");
    const next = new URL(location, current);
    if (next.protocol !== "https:" || next.hostname !== allowedHost || next.username || next.password || next.port)
      throw new Error("SHORT_LINK_UNSAFE_REDIRECT");
    current = next;
  }
  throw new Error("SHORT_LINK_TOO_MANY_REDIRECTS");
}

function absolute(value: string, base: string, image = false) {
  try {
    const url = new URL(value, base);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
    if (!image && url.protocol === "mailto:") return url.toString();
    return "";
  } catch { return ""; }
}

export function sanitizeConfluenceHtml(
  html: string,
  baseUrl: string,
  imageResolver?: (absoluteSource: string, attributes: Record<string, string>) => string | null,
) {
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
      img: (_tag, attrs) => {
        const source = absolute(attrs.src ?? "", baseUrl, true);
        const rewritten = imageResolver ? imageResolver(source, attrs) : source;
        return { tagName: "img", attribs: {
          ...attrs,
          src: rewritten ?? "",
          alt: attrs.alt || (rewritten ? "" : "画像を表示できません"),
          title: attrs.title || (rewritten ? "" : "画像を表示できません"),
          class: `${attrs.class ?? ""}${rewritten ? "" : " confluence-image-unavailable"}`.trim(),
          loading: "lazy",
        } };
      },
    },
  });
}

export const SAFE_IMAGE_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export const MAX_CONFLUENCE_IMAGE_BYTES = 10 * 1024 * 1024;

export type ConfluenceAttachmentDescriptor = {
  id: string;
  title: string;
  pageId: string;
  mediaType: string;
  fileSize: number;
  downloadLink: string;
};

function normalizedFilename(value: string) {
  try { return decodeURIComponent(value).normalize("NFKC").toLocaleLowerCase("en-US"); }
  catch { return value.normalize("NFKC").toLocaleLowerCase("en-US"); }
}

function sourceFilename(source: string) {
  try {
    const url = new URL(source);
    const explicit = url.searchParams.get("filename") ?? url.searchParams.get("fileName");
    if (explicit) return normalizedFilename(explicit);
    const pathname = url.pathname;
    const filename = pathname.split("/").filter(Boolean).at(-1) ?? "";
    return normalizedFilename(filename);
  } catch { return ""; }
}

function storageImagesToViewHtml(html: string, baseUrl: string, pageId: string) {
  return html.replace(
    /<ac:image\b([^>]*)>[\s\S]*?<ri:attachment\b[^>]*ri:filename=(?:"([^"]+)"|'([^']+)')[^>]*\/?>(?:[\s\S]*?<\/ac:image>)?/gi,
    (_whole, imageAttributes: string, doubleQuoted: string, singleQuoted: string) => {
      const filename = doubleQuoted ?? singleQuoted ?? "";
      const width = imageAttributes.match(/ac:width=(?:"(\d+)"|'(\d+)')/i)?.slice(1).find(Boolean);
      const height = imageAttributes.match(/ac:height=(?:"(\d+)"|'(\d+)')/i)?.slice(1).find(Boolean);
      const source = new URL(`/wiki/download/attachments/${pageId}/${encodeURIComponent(filename)}`, baseUrl).toString();
      return `<img src="${source}" alt="${filename.replace(/[&<>"']/g, "")}"${width ? ` width="${width}"` : ""}${height ? ` height="${height}"` : ""}>`;
    },
  );
}

export function sanitizeConfluenceHtmlWithAttachments(
  html: string,
  baseUrl: string,
  attachments: ConfluenceAttachmentDescriptor[],
  proxyPrefix: string,
) {
  const safeAttachments = attachments.filter((item) =>
    SAFE_IMAGE_MEDIA_TYPES.has(item.mediaType.toLowerCase())
    && Number.isFinite(item.fileSize)
    && item.fileSize >= 0
    && item.fileSize <= MAX_CONFLUENCE_IMAGE_BYTES,
  );
  let missingImages = 0;
  const pageId = safeAttachments[0]?.pageId ?? attachments[0]?.pageId ?? "";
  const normalizedHtml = pageId ? storageImagesToViewHtml(html, baseUrl, pageId) : html;
  const sanitizedHtml = sanitizeConfluenceHtml(normalizedHtml, baseUrl, (source, attributes) => {
    const filename = sourceFilename(source);
    let attachmentId = "";
    try { attachmentId = new URL(source).searchParams.get("attachmentId") ?? ""; } catch { /* invalid source */ }
    const attributeFilename = normalizedFilename(attributes.alt || attributes.title || "");
    const match = safeAttachments.find((item) => {
      const title = normalizedFilename(item.title);
      return item.id === attachmentId || title === filename || Boolean(attributeFilename && title === attributeFilename);
    });
    if (!match) { missingImages += 1; return null; }
    return `${proxyPrefix}/${encodeURIComponent(match.id)}`;
  });
  return { html: sanitizedHtml, missingImages, safeAttachments };
}

export function atlassianError(status: number) {
  if (status === 401) return "Confluenceの再認証が必要です";
  if (status === 403) return "Confluenceページを読む権限がありません";
  if (status === 404) return "指定したConfluenceページが見つかりません";
  if (status === 429) return "Confluenceの利用上限に達しました。しばらくして再試行してください";
  if (status >= 500) return "Atlassian側で障害が発生しています。時間をおいて再試行してください";
  return "Confluenceページを取得できませんでした";
}
