import { fetchAllPageAttachments, searchPageAttachmentsByFilename } from "./confluence-attachments.ts";
import { fetchAtlassianAttachmentBinary, validateConfluenceImageSource } from "./confluence-image.ts";
import {
  MAX_CONFLUENCE_IMAGE_BYTES,
  SAFE_IMAGE_MEDIA_TYPES,
  normalizeConfluenceFilename,
  type ConfluenceAttachmentDescriptor,
  type ConfluenceImageReference,
} from "./confluence-safe.ts";

export type SnapshotFailureCode = "scope_missing" | "source_untrusted" | "fetch_failed" | "too_large" | "unsupported_mime";
export type SnapshotImage = {
  assetKey: string;
  filename: string;
  mime: string;
  bytes: ArrayBuffer;
  sha256: string;
  reference: ConfluenceImageReference;
};

function uniqueReferences(representations: ConfluenceImageReference[][]) {
  const result: ConfluenceImageReference[] = [];
  const seen = new Set<string>();
  for (const reference of representations.flat()) {
    const key = reference.attachmentId || reference.fileId || reference.normalizedFilename || reference.sourceUrl || "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(reference);
  }
  return result;
}

function names(item: ConfluenceAttachmentDescriptor) {
  return new Set([item.title, item.fileName].filter(Boolean).map((value) => normalizeConfluenceFilename(value!)));
}

function matches(reference: ConfluenceImageReference, item: ConfluenceAttachmentDescriptor) {
  return item.id === reference.attachmentId
    || Boolean(item.fileId && (item.fileId === reference.fileId || item.fileId === reference.attachmentId))
    || Boolean(reference.normalizedFilename && names(item).has(reference.normalizedFilename));
}

function gatewayDownloadUrl(cloudId: string, link: string) {
  if (/^https:\/\//i.test(link)) return link;
  return `https://api.atlassian.com/ex/confluence/${encodeURIComponent(cloudId)}${link.startsWith("/") ? link : `/${link}`}`;
}

function failureCode(code: string): SnapshotFailureCode {
  if (code === "ATTACHMENT_PERMISSION") return "scope_missing";
  if (code === "ATTACHMENT_TOO_LARGE") return "too_large";
  if (code === "ATTACHMENT_BINARY_UNSAFE") return "unsupported_mime";
  if (code.includes("UNSAFE")) return "source_untrusted";
  return "fetch_failed";
}

async function sha256(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function fetchConfluenceImageSnapshots(input: {
  cloudId: string;
  cloudUrl: string;
  pageId: string;
  token: string;
  representations: ConfluenceImageReference[][];
  fetcher?: typeof fetch;
}) {
  const fetcher = input.fetcher ?? fetch;
  const references = uniqueReferences(input.representations).slice(0, 50);
  const assets: SnapshotImage[] = [];
  const failures: SnapshotFailureCode[] = [];
  let all: ConfluenceAttachmentDescriptor[] | null = null;

  for (const reference of references) {
    let candidates: ConfluenceAttachmentDescriptor[] = [];
    if (reference.filename) {
      const direct = await searchPageAttachmentsByFilename(
        input.cloudId, input.pageId, reference.filename, input.token, fetcher,
      );
      if (!direct.ok && direct.code === "ATTACHMENT_REAUTH_REQUIRED") {
        failures.push("scope_missing"); continue;
      }
      if (direct.ok) candidates = direct.attachments.filter((item) => matches(reference, item));
    }
    if (!candidates.length) {
      if (!all) {
        const listed = await fetchAllPageAttachments(input.cloudId, input.pageId, input.token, fetcher);
        if (!listed.ok && listed.code === "ATTACHMENT_REAUTH_REQUIRED") {
          failures.push("scope_missing"); continue;
        }
        all = listed.ok ? listed.attachments : [];
      }
      candidates = all.filter((item) => matches(reference, item));
    }

    const candidate = candidates[0];
    if (candidate && (!SAFE_IMAGE_MEDIA_TYPES.has(candidate.mediaType) || candidate.fileSize > MAX_CONFLUENCE_IMAGE_BYTES)) {
      failures.push(candidate.fileSize > MAX_CONFLUENCE_IMAGE_BYTES ? "too_large" : "unsupported_mime");
      continue;
    }
    const urls: string[] = [];
    if (candidate?.downloadLink) urls.push(gatewayDownloadUrl(input.cloudId, candidate.downloadLink));
    if (candidate?.id) urls.push(
      `https://api.atlassian.com/ex/confluence/${encodeURIComponent(input.cloudId)}/wiki/rest/api/content/${encodeURIComponent(input.pageId)}/child/attachment/${encodeURIComponent(candidate.id)}/download`,
    );
    if (reference.sourceUrl) {
      const safeSource = validateConfluenceImageSource(reference.sourceUrl, input.cloudUrl, input.cloudId, input.pageId);
      if (safeSource) urls.push(safeSource);
      else if (!urls.length) { failures.push("source_untrusted"); continue; }
    }
    if (!urls.length) { failures.push("fetch_failed"); continue; }

    let binary: Awaited<ReturnType<typeof fetchAtlassianAttachmentBinary>> | null = null;
    for (const url of [...new Set(urls)]) {
      binary = await fetchAtlassianAttachmentBinary(url, input.token, candidate?.mediaType || "image/*", fetcher);
      if (binary.ok) break;
    }
    if (!binary?.ok) { failures.push(failureCode(binary?.code ?? "ATTACHMENT_DOWNLOAD_FAILED")); continue; }
    const filename = candidate?.title || reference.filename || "confluence-image";
    assets.push({
      assetKey: crypto.randomUUID().replaceAll("-", ""),
      filename,
      mime: binary.mediaType,
      bytes: binary.bytes,
      sha256: await sha256(binary.bytes),
      reference,
    });
  }
  return { references, assets, failures };
}

export const SNAPSHOT_FAILURE_MESSAGES: Record<SnapshotFailureCode, string> = {
  scope_missing: "Atlassianの画像権限を再承認してください。",
  source_untrusted: "安全性を確認できない画像参照がありました。",
  fetch_failed: "Confluenceから画像を取得できませんでした。",
  too_large: "10MiBを超える画像は保存できません。",
  unsupported_mime: "対応していない画像形式がありました。",
};
