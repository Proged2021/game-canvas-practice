import { MAX_CONFLUENCE_IMAGE_BYTES, SAFE_IMAGE_MEDIA_TYPES } from "./confluence-safe.ts";

const MAX_REDIRECTS = 3;
export type ResolverHttpTrace = { status: number; hostCategory: string };

function validHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const ipLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":");
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && !ipLiteral && !url.pathname.includes("..") ? url : null;
  } catch { return null; }
}

export function atlassianHostCategory(value: string) {
  const url = validHttpsUrl(value);
  if (!url) return "invalid";
  const host = url.hostname.toLowerCase();
  if (host === "api.atlassian.com") return "oauth_gateway";
  if (host === "api.media.atlassian.com" || host === "media.atlassian.com" || host.endsWith(".media.atlassian.com"))
    return "atlassian_media";
  if (host.endsWith(".atl-paas.net")) return "atl_paas_media";
  return "untrusted";
}

export function isAllowedAtlassianDownloadUrl(value: string) {
  return ["oauth_gateway", "atlassian_media", "atl_paas_media"].includes(atlassianHostCategory(value));
}

function gatewayPrefix(cloudId: string) {
  return `/ex/confluence/${encodeURIComponent(cloudId)}`;
}

export function validateConfluenceImageSource(value: string, cloudUrl: string, cloudId: string, pageId: string) {
  try {
    const url = new URL(value, cloudUrl);
    const tenantHost = new URL(cloudUrl).hostname.toLowerCase();
    const download = new RegExp(`^/wiki/download/attachments/${pageId}(?:/|$)`, "i");
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (url.hostname.toLowerCase() === tenantHost && download.test(url.pathname))
      return `https://api.atlassian.com${gatewayPrefix(cloudId)}${url.pathname}${url.search}`;
    if (url.hostname === "api.atlassian.com"
      && url.pathname.startsWith(`${gatewayPrefix(cloudId)}/`)
      && download.test(url.pathname.slice(gatewayPrefix(cloudId).length))) return url.toString();
    // 本文中のmedia/CDN URLは信頼しない。Atlassian APIのLocationとしてのみ許可する。
    return null;
  } catch { return null; }
}

function trustedGatewayStart(value: string, context?: { cloudId: string; pageId: string; attachmentId?: string }) {
  const url = validHttpsUrl(value);
  if (!url || url.hostname !== "api.atlassian.com") return false;
  if (!context) return url.pathname.startsWith("/ex/confluence/");
  const base = gatewayPrefix(context.cloudId);
  if (!url.pathname.startsWith(`${base}/wiki/`)) return false;
  const confluencePath = url.pathname.slice(base.length);
  if (new RegExp(`^/wiki/download/attachments/${context.pageId}(?:/|$)`, "i").test(confluencePath)) return true;
  if (!context.attachmentId) return false;
  const attachment = encodeURIComponent(context.attachmentId);
  return confluencePath === `/wiki/rest/api/content/${encodeURIComponent(context.pageId)}/child/attachment/${attachment}/download`
    || confluencePath === `/wiki/api/v2/attachments/${attachment}/thumbnail/download`;
}

function detectedImageMime(bytes: Uint8Array) {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6) {
    const signature = String.fromCharCode(...bytes.slice(0, 6));
    if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  }
  if (bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export type AttachmentBinaryResult =
  | { ok: true; bytes: ArrayBuffer; mediaType: string; trace: ResolverHttpTrace[] }
  | { ok: false; code: string; status: number; trace: ResolverHttpTrace[] };

export async function fetchAtlassianAttachmentBinary(
  startUrl: string,
  token: string,
  expectedMediaType: string,
  fetcher: typeof fetch = fetch,
  context?: { cloudId: string; pageId: string; attachmentId?: string },
): Promise<AttachmentBinaryResult> {
  const trace: ResolverHttpTrace[] = [];
  let current = startUrl;
  if (!trustedGatewayStart(current, context))
    return { ok: false, code: "UNSAFE_DOWNLOAD_URL", status: 502, trace };
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const category = atlassianHostCategory(current);
    if (hop === 0 ? category !== "oauth_gateway" : !["atlassian_media", "atl_paas_media"].includes(category))
      return { ok: false, code: "DOWNLOAD_REDIRECT_UNSAFE", status: 502, trace };
    const headers: Record<string, string> = { accept: "image/*,application/octet-stream;q=0.9" };
    if (hop === 0) headers.authorization = `Bearer ${token}`;
    const response = await fetcher(current, { method: "GET", redirect: "manual", headers });
    trace.push({ status: response.status, hostCategory: category });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || hop === MAX_REDIRECTS)
        return { ok: false, code: "DOWNLOAD_REDIRECT_INVALID", status: 502, trace };
      const next = new URL(location, current).toString();
      if (!["atlassian_media", "atl_paas_media"].includes(atlassianHostCategory(next)))
        return { ok: false, code: "DOWNLOAD_REDIRECT_UNSAFE", status: 502, trace };
      current = next;
      continue;
    }
    if (!response.ok) return {
      ok: false,
      code: response.status === 401 || response.status === 403 ? "ATTACHMENT_PERMISSION" : "ATTACHMENT_DOWNLOAD_FAILED",
      status: response.status === 401 || response.status === 403 ? 403 : 502,
      trace,
    };
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_CONFLUENCE_IMAGE_BYTES)
      return { ok: false, code: "ATTACHMENT_TOO_LARGE", status: 413, trace };
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_CONFLUENCE_IMAGE_BYTES)
      return { ok: false, code: "ATTACHMENT_TOO_LARGE", status: 413, trace };
    const detected = detectedImageMime(new Uint8Array(bytes));
    const declared = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
    const expected = expectedMediaType.toLowerCase();
    if (!detected || !SAFE_IMAGE_MEDIA_TYPES.has(detected)
      || (SAFE_IMAGE_MEDIA_TYPES.has(expected) && expected !== detected)
      || (declared !== "application/octet-stream" && declared && SAFE_IMAGE_MEDIA_TYPES.has(declared) && declared !== detected)
      || (declared && declared !== "application/octet-stream" && !SAFE_IMAGE_MEDIA_TYPES.has(declared)))
      return { ok: false, code: "ATTACHMENT_BINARY_UNSAFE", status: 415, trace };
    return { ok: true, bytes, mediaType: detected, trace };
  }
  return { ok: false, code: "DOWNLOAD_REDIRECT_LIMIT", status: 502, trace };
}
