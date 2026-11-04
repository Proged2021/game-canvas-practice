import type { ConfluenceAttachmentDescriptor } from "./confluence-safe.ts";

const MAX_ATTACHMENT_PAGES = 20;
const PAGE_LIMIT = 100;

export type RawAttachment = {
  id?: string | number;
  title?: string;
  fileName?: string;
  filename?: string;
  pageId?: string | number;
  mediaType?: string;
  fileSize?: number;
  fileId?: string;
  downloadLink?: string;
  _links?: { download?: string; next?: string };
};

type AttachmentPage = {
  results?: RawAttachment[];
  _links?: { next?: string };
};

export function normalizeAttachment(item: RawAttachment, pageId: string) {
  const id = item.id == null ? "" : String(item.id);
  const mediaType = typeof item.mediaType === "string" ? item.mediaType.toLowerCase() : "";
  const downloadLink = item.downloadLink ?? item._links?.download ?? "";
  const title = item.title ?? item.fileName ?? item.filename ?? "";
  const listedPageId = item.pageId == null ? pageId : String(item.pageId);
  if (!id || listedPageId !== pageId || downloadLink.startsWith("//")) return null;
  if (downloadLink && !/^https:\/\//i.test(downloadLink) && !/^\/(?:wiki\/)?download\/attachments\//i.test(downloadLink)) return null;
  return {
    id,
    title,
    fileName: item.fileName ?? item.filename,
    fileId: item.fileId,
    pageId,
    mediaType,
    fileSize: Number(item.fileSize),
    downloadLink,
  } satisfies ConfluenceAttachmentDescriptor;
}

export function attachmentNeedsSupplement(item: ConfluenceAttachmentDescriptor) {
  return !item.title
    || !item.mediaType
    || !Number.isFinite(item.fileSize)
    || !item.downloadLink;
}

export async function fetchAttachmentMetadata(
  cloudId: string,
  pageId: string,
  attachmentId: string,
  token: string,
  fetcher: typeof fetch = fetch,
) {
  const url = `https://api.atlassian.com/ex/confluence/${encodeURIComponent(cloudId)}/wiki/api/v2/attachments/${encodeURIComponent(attachmentId)}`;
  const response = await fetcher(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  if (response.status === 401 || response.status === 403)
    return { ok: false as const, status: response.status, code: "ATTACHMENT_REAUTH_REQUIRED" as const };
  if (!response.ok) return { ok: false as const, status: response.status, code: "ATTACHMENT_METADATA_FAILED" as const };
  const attachment = normalizeAttachment(await response.json() as RawAttachment, pageId);
  return attachment
    ? { ok: true as const, status: response.status, attachment }
    : { ok: false as const, status: 502, code: "ATTACHMENT_METADATA_INVALID" as const };
}

export async function searchPageAttachmentsByFilename(
  cloudId: string,
  pageId: string,
  filename: string,
  token: string,
  fetcher: typeof fetch = fetch,
) {
  const url = `https://api.atlassian.com/ex/confluence/${encodeURIComponent(cloudId)}/wiki/api/v2/pages/${encodeURIComponent(pageId)}/attachments?filename=${encodeURIComponent(filename)}&limit=100`;
  const response = await fetcher(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  if (response.status === 401 || response.status === 403)
    return { ok: false as const, status: response.status, code: "ATTACHMENT_REAUTH_REQUIRED" as const };
  if (!response.ok) return { ok: false as const, status: response.status, code: "ATTACHMENT_LIST_FAILED" as const };
  const body = await response.json() as AttachmentPage;
  return {
    ok: true as const,
    status: response.status,
    attachments: (Array.isArray(body.results) ? body.results : [])
      .map((item) => normalizeAttachment(item, pageId))
      .filter((item) => item !== null),
  };
}

export type AttachmentListResult =
  | {
      ok: true;
      attachments: ConfluenceAttachmentDescriptor[];
      pages: number;
      rawCount: number;
      status: number;
    }
  | {
      ok: false;
      status: number;
      code: "ATTACHMENT_REAUTH_REQUIRED" | "ATTACHMENT_LIST_FAILED" | "ATTACHMENT_PAGINATION_UNSAFE";
    };

function nextFromLinkHeader(value: string | null) {
  if (!value) return null;
  for (const part of value.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel=(?:"next"|next)/i);
    if (match) return match[1];
  }
  return null;
}

function safeNextUrl(next: string, current: string, gatewayBase: string, requiredPath: string) {
  try {
    let resolved: URL;
    if (next.startsWith("/wiki/")) resolved = new URL(`${gatewayBase}${next}`);
    else resolved = new URL(next, current);
    return resolved.protocol === "https:"
      && resolved.hostname === "api.atlassian.com"
      && resolved.pathname === requiredPath
      ? resolved.toString()
      : null;
  } catch {
    return null;
  }
}

export async function fetchAllPageAttachments(
  cloudId: string,
  pageId: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<AttachmentListResult> {
  const gatewayBase = `https://api.atlassian.com/ex/confluence/${encodeURIComponent(cloudId)}`;
  const requiredPath = `/ex/confluence/${encodeURIComponent(cloudId)}/wiki/api/v2/pages/${encodeURIComponent(pageId)}/attachments`;
  let url = `${gatewayBase}/wiki/api/v2/pages/${encodeURIComponent(pageId)}/attachments?limit=${PAGE_LIMIT}`;
  const attachments: ConfluenceAttachmentDescriptor[] = [];
  let rawCount = 0;

  for (let pages = 1; pages <= MAX_ATTACHMENT_PAGES; pages += 1) {
    const response = await fetcher(url, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (response.status === 401 || response.status === 403)
      return { ok: false, status: response.status, code: "ATTACHMENT_REAUTH_REQUIRED" };
    if (!response.ok)
      return { ok: false, status: response.status, code: "ATTACHMENT_LIST_FAILED" };
    const body = (await response.json()) as AttachmentPage;
    const results = Array.isArray(body.results) ? body.results : [];
    rawCount += results.length;
    for (const item of results) {
      const normalized = normalizeAttachment(item, pageId);
      if (normalized) attachments.push(normalized);
    }
    const next = body._links?.next ?? nextFromLinkHeader(response.headers.get("link"));
    if (!next) return { ok: true, attachments, pages, rawCount, status: response.status };
    const safe = safeNextUrl(next, url, gatewayBase, requiredPath);
    if (!safe) return { ok: false, status: 502, code: "ATTACHMENT_PAGINATION_UNSAFE" };
    url = safe;
  }
  return { ok: false, status: 502, code: "ATTACHMENT_LIST_FAILED" };
}
