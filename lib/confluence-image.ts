import {
  MAX_CONFLUENCE_IMAGE_BYTES,
  SAFE_IMAGE_MEDIA_TYPES,
} from "./confluence-safe.ts";

const MAX_REDIRECTS = 5;

export function isAllowedAtlassianDownloadUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const isIpLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":");
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !isIpLiteral &&
      (host === "api.atlassian.com" ||
        host.endsWith(".atlassian.com") ||
        host.endsWith(".atlassian.net") ||
        host.endsWith(".atl-paas.net"))
    );
  } catch {
    return false;
  }
}

export function validateConfluenceImageSource(
  value: string,
  cloudUrl: string,
  cloudId: string,
  pageId: string,
) {
  try {
    const url = new URL(value, cloudUrl);
    if (!isAllowedAtlassianDownloadUrl(url.toString())) return null;
    const tenantHost = new URL(cloudUrl).hostname.toLowerCase();
    const gatewayPrefix = `/ex/confluence/${encodeURIComponent(cloudId)}/`;
    const downloadPattern = new RegExp(`/wiki/download/attachments/${pageId}(?:/|$)`, "i");
    if (url.hostname.toLowerCase() === tenantHost && downloadPattern.test(url.pathname)) {
      return new URL(`${gatewayPrefix.replace(/\/$/, "")}${url.pathname}${url.search}`, "https://api.atlassian.com").toString();
    }
    if (url.hostname === "api.atlassian.com"
      && url.pathname.startsWith(gatewayPrefix)
      && downloadPattern.test(url.pathname)) return url.toString();
    if ((url.hostname === "api.media.atlassian.com"
      || url.hostname === "media.atlassian.com"
      || url.hostname.endsWith(".atl-paas.net"))
      && !url.pathname.includes("..")) return url.toString();
    return null;
  } catch { return null; }
}

export type AttachmentBinaryResult =
  | { ok: true; bytes: ArrayBuffer; mediaType: string }
  | { ok: false; code: string; status: number };

export async function fetchAtlassianAttachmentBinary(
  startUrl: string,
  token: string,
  expectedMediaType: string,
  fetcher: typeof fetch = fetch,
): Promise<AttachmentBinaryResult> {
  let current = startUrl;
  if (!isAllowedAtlassianDownloadUrl(current))
    return { ok: false, code: "UNSAFE_DOWNLOAD_URL", status: 502 };
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = new URL(current);
    const headers: Record<string, string> = { accept: expectedMediaType };
    if (url.hostname === "api.atlassian.com") headers.authorization = `Bearer ${token}`;
    const response = await fetcher(current, { redirect: "manual", headers });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || hop === MAX_REDIRECTS)
        return { ok: false, code: "DOWNLOAD_REDIRECT_INVALID", status: 502 };
      const next = new URL(location, current).toString();
      if (!isAllowedAtlassianDownloadUrl(next))
        return { ok: false, code: "DOWNLOAD_REDIRECT_UNSAFE", status: 502 };
      current = next;
      continue;
    }
    if (!response.ok)
      return {
        ok: false,
        code: response.status === 401 || response.status === 403 ? "ATTACHMENT_PERMISSION" : "ATTACHMENT_DOWNLOAD_FAILED",
        status: response.status === 401 || response.status === 403 ? 403 : 502,
      };
    const mediaType = (response.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (
      !SAFE_IMAGE_MEDIA_TYPES.has(mediaType) ||
      (declaredLength > 0 && declaredLength > MAX_CONFLUENCE_IMAGE_BYTES)
    )
      return { ok: false, code: "ATTACHMENT_BINARY_UNSAFE", status: 415 };
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_CONFLUENCE_IMAGE_BYTES)
      return { ok: false, code: "ATTACHMENT_TOO_LARGE", status: 413 };
    return { ok: true, bytes, mediaType };
  }
  return { ok: false, code: "DOWNLOAD_REDIRECT_LIMIT", status: 502 };
}
