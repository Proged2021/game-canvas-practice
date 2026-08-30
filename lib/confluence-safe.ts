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
  fileName?: string;
  fileId?: string;
  pageId: string;
  mediaType: string;
  fileSize: number;
  downloadLink: string;
};

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ",
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] !== "#") return named[entity.toLowerCase()] ?? whole;
    const point = entity[1].toLowerCase() === "x"
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10);
    try { return Number.isFinite(point) ? String.fromCodePoint(point) : whole; }
    catch { return whole; }
  });
}

function repeatedlyDecodeURIComponent(value: string) {
  let current = value;
  for (let index = 0; index < 3; index += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch { break; }
  }
  return current;
}

export function normalizeConfluenceFilename(value: string) {
  return repeatedlyDecodeURIComponent(decodeHtmlEntities(value.trim()))
    .normalize("NFKC")
    .toLocaleLowerCase("en-US");
}

function sourceFilename(source: string) {
  try {
    const url = new URL(source, "https://confluence.invalid");
    const explicit = url.searchParams.get("filename") ?? url.searchParams.get("fileName");
    if (explicit) return normalizeConfluenceFilename(explicit);
    const pathname = url.pathname;
    const filename = pathname.split("/").filter(Boolean).at(-1) ?? "";
    return normalizeConfluenceFilename(filename);
  } catch { return ""; }
}

function attributeValue(attributes: string, localName: string) {
  const escaped = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attributes.match(new RegExp(`(?:[\\w.-]+:)?${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match ? decodeHtmlEntities(match[1] ?? match[2] ?? "") : "";
}

export type ConfluenceImageReference = {
  filename: string;
  normalizedFilename: string;
  attachmentId?: string;
  fileId?: string;
};

export function extractConfluenceStorageImageReferences(storageHtml: string) {
  const references: ConfluenceImageReference[] = [];
  const imagePattern = /<(?:[\w.-]+:)?image\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?image\s*>/gi;
  for (const imageMatch of storageHtml.matchAll(imagePattern)) {
    const inner = imageMatch[2];
    const attachment = inner.match(/<(?:[\w.-]+:)?attachment\b([^>]*)\/?\s*>/i);
    if (!attachment) continue;
    const filename = attributeValue(attachment[1], "filename");
    if (!filename) continue;
    references.push({
      filename,
      normalizedFilename: normalizeConfluenceFilename(filename),
      attachmentId: attributeValue(attachment[1], "attachment-id") || undefined,
      fileId: attributeValue(attachment[1], "file-id") || undefined,
    });
  }
  return references;
}

function storageImagesToViewHtml(html: string, baseUrl: string, pageId: string) {
  return html.replace(
    /<(?:[\w.-]+:)?image\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?image\s*>/gi,
    (whole, imageAttributes: string, inner: string) => {
      const attachment = inner.match(/<(?:[\w.-]+:)?attachment\b([^>]*)\/?\s*>/i);
      if (!attachment) return whole;
      const filename = attributeValue(attachment[1], "filename");
      if (!filename) return whole;
      const width = attributeValue(imageAttributes, "width").match(/^\d+$/)?.[0];
      const height = attributeValue(imageAttributes, "height").match(/^\d+$/)?.[0];
      const attachmentId = attributeValue(attachment[1], "attachment-id");
      const source = new URL(`/wiki/download/attachments/${pageId}/${encodeURIComponent(filename)}`, baseUrl).toString();
      const safeAlt = filename.replace(/[&<>"']/g, "");
      return `<img src="${source}" alt="${safeAlt}"${attachmentId ? ` data-attachment-id="${attachmentId.replace(/[^A-Za-z0-9_-]/g, "")}"` : ""}${width ? ` width="${width}"` : ""}${height ? ` height="${height}"` : ""}>`;
    },
  );
}

function sourcePageId(source: string) {
  try { return new URL(source).pathname.match(/\/(?:wiki\/)?download\/attachments\/(\d{1,30})(?:\/|$)/i)?.[1] ?? ""; }
  catch { return ""; }
}

function sourceTokens(source: string) {
  try {
    const url = new URL(source);
    return new Set([
      ...url.pathname.split("/").filter(Boolean),
      ...url.searchParams.values(),
    ].map((value) => repeatedlyDecodeURIComponent(value)));
  } catch { return new Set<string>(); }
}

function attachmentNames(item: ConfluenceAttachmentDescriptor) {
  const values = [item.title, item.fileName, sourceFilename(item.downloadLink)];
  return new Set(values.filter(Boolean).map(normalizeConfluenceFilename));
}

export function sanitizeConfluenceHtmlWithAttachments(
  html: string,
  baseUrl: string,
  attachments: ConfluenceAttachmentDescriptor[],
  proxyPrefix: string,
  storageHtml = "",
) {
  const safeAttachments = attachments.filter((item) =>
    SAFE_IMAGE_MEDIA_TYPES.has(item.mediaType.toLowerCase())
    && Number.isFinite(item.fileSize)
    && item.fileSize >= 0
    && item.fileSize <= MAX_CONFLUENCE_IMAGE_BYTES,
  );
  let missingImages = 0;
  const pageId = safeAttachments[0]?.pageId ?? attachments[0]?.pageId ?? "";
  const storageReferences = extractConfluenceStorageImageReferences(storageHtml || html);
  const normalizedHtml = pageId ? storageImagesToViewHtml(html, baseUrl, pageId) : html;
  let imageIndex = 0;
  let matchedImages = 0;
  const sanitizedHtml = sanitizeConfluenceHtml(normalizedHtml, baseUrl, (source, attributes) => {
    const storageReference = storageReferences[imageIndex++];
    const filename = sourceFilename(source);
    let attachmentId = "";
    try { attachmentId = new URL(source).searchParams.get("attachmentId") ?? ""; } catch { /* invalid source */ }
    attachmentId ||= attributes["data-attachment-id"] ?? attributes["data-linked-resource-id"] ?? "";
    const attributeFilename = normalizeConfluenceFilename(
      attributes["data-linked-resource-default-alias"] || attributes.alt || attributes.title || "",
    );
    const tokens = sourceTokens(source);
    const referencedPageId = sourcePageId(source);
    const match = safeAttachments.find((item) => {
      const names = attachmentNames(item);
      return item.id === attachmentId
        || Boolean(item.fileId && (tokens.has(item.fileId) || item.fileId === attributes["data-media-id"]))
        || Boolean(filename && names.has(filename))
        || Boolean(attributeFilename && names.has(attributeFilename))
        || Boolean(storageReference && (
          item.id === storageReference.attachmentId
          || item.fileId === storageReference.fileId
          || names.has(storageReference.normalizedFilename)
        ))
        || Boolean(referencedPageId === item.pageId && names.has(filename));
    });
    if (!match) { missingImages += 1; return null; }
    matchedImages += 1;
    return `${proxyPrefix}/${encodeURIComponent(match.id)}`;
  });
  return { html: sanitizedHtml, missingImages, matchedImages, imageReferences: imageIndex, safeAttachments };
}

export function atlassianError(status: number) {
  if (status === 401) return "Confluenceの再認証が必要です";
  if (status === 403) return "Confluenceページを読む権限がありません";
  if (status === 404) return "指定したConfluenceページが見つかりません";
  if (status === 429) return "Confluenceの利用上限に達しました。しばらくして再試行してください";
  if (status >= 500) return "Atlassian側で障害が発生しています。時間をおいて再試行してください";
  return "Confluenceページを取得できませんでした";
}
