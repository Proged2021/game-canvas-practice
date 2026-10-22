import {
  attachmentNeedsSupplement,
  fetchAllPageAttachments,
  fetchAttachmentMetadata,
} from "./confluence-attachments.ts";
import {
  atlassianHostCategory,
  fetchAtlassianAttachmentBinary,
  validateConfluenceImageSource,
} from "./confluence-image.ts";
import {
  MAX_CONFLUENCE_IMAGE_BYTES,
  SAFE_IMAGE_MEDIA_TYPES,
  normalizeConfluenceFilename,
  type ConfluenceAttachmentDescriptor,
  type ConfluenceImageReference,
} from "./confluence-safe.ts";

export type SnapshotFailureCode = "scope_missing" | "source_untrusted" | "fetch_failed" | "too_large" | "unsupported_mime";
export type ResolverStageTrace = {
  stage: string;
  status: number;
  hostCategory: string;
  sentAuthorization?: boolean;
  signedQuery?: boolean;
};
export type LogicalConfluenceImage = ConfluenceImageReference & { sourceUrls: string[] };
export type SnapshotImage = {
  assetKey: string;
  filename: string;
  mime: string;
  bytes: ArrayBuffer;
  sha256: string;
  reference: LogicalConfluenceImage;
};

function downloadPathKey(value: string | undefined, pageId: string) {
  if (!value) return "";
  try {
    const path = decodeURIComponent(new URL(value, "https://invalid.local").pathname).normalize("NFKC").toLocaleLowerCase("en-US");
    return new RegExp(`/(?:wiki/)?download/attachments/${pageId}(?:/|$)`, "i").test(path) ? path : "";
  } catch { return ""; }
}

function referenceKeys(reference: ConfluenceImageReference, pageId: string) {
  return [
    reference.attachmentId ? `attachment:${reference.attachmentId}` : "",
    reference.fileId ? `file:${reference.fileId}` : "",
    reference.normalizedFilename ? `filename:${pageId}:${reference.normalizedFilename}` : "",
    downloadPathKey(reference.sourceUrl, pageId) ? `path:${pageId}:${downloadPathKey(reference.sourceUrl, pageId)}` : "",
  ].filter(Boolean);
}

function sharesStrongIdentity(first: ConfluenceImageReference, second: ConfluenceImageReference) {
  return Boolean((first.attachmentId && first.attachmentId === second.attachmentId)
    || (first.fileId && first.fileId === second.fileId)
    || (first.attachmentId && first.attachmentId === second.fileId)
    || (first.fileId && first.fileId === second.attachmentId));
}

function conflictingStrongIdentities(first: ConfluenceImageReference, second: ConfluenceImageReference) {
  if (sharesStrongIdentity(first, second)) return false;
  return Boolean((first.attachmentId && second.attachmentId && first.attachmentId !== second.attachmentId)
    || (first.fileId && second.fileId && first.fileId !== second.fileId));
}

function hasStrongIdentity(reference: ConfluenceImageReference) {
  return Boolean(reference.attachmentId || reference.fileId);
}

export function dedupeConfluenceImageReferences(pageId: string, representations: ConfluenceImageReference[][]) {
  const groups: Array<LogicalConfluenceImage & { keys: Set<string> }> = [];
  const references = representations.flat();
  const weakKeyReferences = new Map<string, ConfluenceImageReference[]>();
  for (const reference of references) {
    if (!hasStrongIdentity(reference)) continue;
    for (const key of referenceKeys(reference, pageId).filter((value) => /^(?:filename|path):/.test(value))) {
      const previous = weakKeyReferences.get(key) ?? [];
      previous.push(reference);
      weakKeyReferences.set(key, previous);
    }
  }
  const ambiguousWeakKeys = new Set([...weakKeyReferences].filter(([, values]) =>
    values.some((first, index) => values.slice(index + 1).some((second) => conflictingStrongIdentities(first, second))))
    .map(([key]) => key));
  for (const reference of references) {
    const keys = referenceKeys(reference, pageId);
    if (!keys.length) continue;
    let group = groups.find((candidate) => sharesStrongIdentity(candidate, reference))
      ?? groups.find((candidate) => !conflictingStrongIdentities(candidate, reference)
        && keys.some((key) => candidate.keys.has(key)
          && (!ambiguousWeakKeys.has(key) || (!hasStrongIdentity(candidate) && !hasStrongIdentity(reference)))));
    if (!group) {
      group = { ...reference, sourceUrls: [], keys: new Set() };
      groups.push(group);
    }
    for (const key of keys) group.keys.add(key);
    group.attachmentId ||= reference.attachmentId;
    group.fileId ||= reference.fileId;
    if (!group.filename && reference.filename) {
      group.filename = reference.filename;
      group.normalizedFilename = reference.normalizedFilename;
    }
    if (reference.sourceUrl && !group.sourceUrls.includes(reference.sourceUrl)) group.sourceUrls.push(reference.sourceUrl);
    // 後から得た強い識別子を既存のfilename/pathグループにも伝播させる。
    for (const key of referenceKeys(group, pageId)) group.keys.add(key);
  }
  return groups.map((group) => ({
    filename: group.filename,
    normalizedFilename: group.normalizedFilename,
    attachmentId: group.attachmentId,
    fileId: group.fileId,
    sourceUrl: group.sourceUrl,
    sourceUrls: group.sourceUrls,
  }));
}

function names(item: ConfluenceAttachmentDescriptor) {
  return new Set([item.title, item.fileName].filter(Boolean).map((value) => normalizeConfluenceFilename(value!)));
}

function selectAttachment(reference: LogicalConfluenceImage, attachments: ConfluenceAttachmentDescriptor[]) {
  const byAttachmentId = attachments.filter((item) => item.id === reference.attachmentId);
  const byFileId = attachments.filter((item) => Boolean(item.fileId
    && (item.fileId === reference.fileId || item.fileId === reference.attachmentId)));
  const byFilename = attachments.filter((item) => Boolean(reference.normalizedFilename
    && names(item).has(reference.normalizedFilename)));
  const matches = byAttachmentId.length ? byAttachmentId : byFileId.length ? byFileId : byFilename;
  const candidates = [...new Map(matches.map((item) => [item.id, item])).values()];
  return { candidate: candidates.length === 1 ? candidates[0] : undefined, ambiguous: candidates.length > 1 };
}

function metadataDownloadUrl(cloudId: string, pageId: string, link: string, cloudUrl: string) {
  const absolute = /^https:\/\//i.test(link) ? link : new URL(link, cloudUrl).toString();
  return validateConfluenceImageSource(absolute, cloudUrl, cloudId, pageId);
}

function failureCode(code: string): SnapshotFailureCode {
  if (code === "API_TOKEN_INVALID" || code === "API_PERMISSION") return "scope_missing";
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
  onAsset?: (asset: SnapshotImage) => Promise<void>;
  retainAssets?: boolean;
  stopOnRateLimit?: boolean;
}) {
  const fetcher = input.fetcher ?? fetch;
  const references = dedupeConfluenceImageReferences(input.pageId, input.representations).slice(0, 50);
  const assets: SnapshotImage[] = [];
  const failures: SnapshotFailureCode[] = [];
  const diagnostics: Array<{ image: number; stages: ResolverStageTrace[]; final: "saved" | SnapshotFailureCode; finalCode?: string }> = [];
  const warnings: Array<{
    requestStage: "attachment_metadata";
    status: number;
    hostCategory: "oauth_gateway";
    pathTemplate: "/wiki/api/v2/attachments/{attachment_id}";
    queryNames: [];
    idCategory: "attachment_id";
    optional: true;
  }> = [];

  if (!references.length) return { references, assets, failures, diagnostics, warnings };

  // 一覧は同期ごとに一度だけ取得し、この結果をcanonical metadataとして全画像で共有する。
  const listed = await fetchAllPageAttachments(input.cloudId, input.pageId, input.token, fetcher);
  const listStage: ResolverStageTrace = {
    stage: "v2_attachment_list",
    status: listed.status ?? (listed.ok ? 200 : 502),
    hostCategory: "oauth_gateway",
  };
  if (!listed.ok) {
    const final: SnapshotFailureCode = listed.code === "ATTACHMENT_REAUTH_REQUIRED" ? "scope_missing" : "fetch_failed";
    for (const [index] of references.entries()) {
      failures.push(final);
      diagnostics.push({ image: index + 1, stages: [listStage], final, finalCode: listed.code });
    }
    return { references, assets, failures, diagnostics, warnings };
  }
  const all = listed.attachments;

  for (const [index, reference] of references.entries()) {
    const stages: ResolverStageTrace[] = [listStage];
    const selection = selectAttachment(reference, all);
    if (selection.ambiguous) {
      const final = "source_untrusted" as const;
      failures.push(final);
      diagnostics.push({ image: index + 1, stages, final, finalCode: "ATTACHMENT_AMBIGUOUS" });
      continue;
    }
    let candidate = selection.candidate;
    if (candidate?.id && attachmentNeedsSupplement(candidate)) {
      const metadata = await fetchAttachmentMetadata(input.cloudId, input.pageId, candidate.id, input.token, fetcher);
      stages.push({ stage: "attachment_metadata", status: metadata.status, hostCategory: "oauth_gateway" });
      if (!metadata.ok && metadata.status === 429 && input.stopOnRateLimit) {
        failures.push("fetch_failed");
        diagnostics.push({ image: index + 1, stages, final: "fetch_failed", finalCode: "ATTACHMENT_RATE_LIMITED" });
        break;
      }
      if (metadata.ok) candidate = { ...candidate, ...metadata.attachment };
      else warnings.push({
        requestStage: "attachment_metadata",
        status: metadata.status,
        hostCategory: "oauth_gateway",
        pathTemplate: "/wiki/api/v2/attachments/{attachment_id}",
        queryNames: [],
        idCategory: "attachment_id",
        optional: true,
      });
    }
    if (candidate && ((candidate.mediaType && !SAFE_IMAGE_MEDIA_TYPES.has(candidate.mediaType))
      || (Number.isFinite(candidate.fileSize) && candidate.fileSize > MAX_CONFLUENCE_IMAGE_BYTES))) {
      const final = candidate.fileSize > MAX_CONFLUENCE_IMAGE_BYTES ? "too_large" : "unsupported_mime";
      failures.push(final); diagnostics.push({ image: index + 1, stages, final, finalCode: final === "too_large" ? "ATTACHMENT_TOO_LARGE" : "ATTACHMENT_BINARY_UNSAFE" }); continue;
    }

    const attempts: Array<{ stage: string; url: string; attachmentId?: string }> = [];
    if (candidate?.id) {
      const id = encodeURIComponent(candidate.id);
      const base = `https://api.atlassian.com/ex/confluence/${encodeURIComponent(input.cloudId)}`;
      attempts.push({
        stage: "v1_attachment_download",
        url: `${base}/wiki/rest/api/content/${encodeURIComponent(input.pageId)}/child/attachment/${id}/download`,
        attachmentId: candidate.id,
      });
      attempts.push({
        stage: "v2_thumbnail_download",
        url: `${base}/wiki/api/v2/attachments/${id}/thumbnail/download?width=1600`,
        attachmentId: candidate.id,
      });
      if (candidate.downloadLink) {
        const safe = metadataDownloadUrl(input.cloudId, input.pageId, candidate.downloadLink, input.cloudUrl);
        if (safe) attempts.push({ stage: "metadata_download_link", url: safe, attachmentId: candidate.id });
      }
    }
    for (const source of reference.sourceUrls) {
      const safe = validateConfluenceImageSource(source, input.cloudUrl, input.cloudId, input.pageId);
      if (safe) attempts.push({ stage: "verified_export_view", url: safe, attachmentId: candidate?.id });
      else stages.push({ stage: "body_media_rejected", status: 0, hostCategory: atlassianHostCategory(source) });
    }

    let binary: Awaited<ReturnType<typeof fetchAtlassianAttachmentBinary>> | null = null;
    let rateLimited = false;
    for (const attempt of attempts.filter((item, itemIndex, values) => values.findIndex((other) => other.url === item.url) === itemIndex)) {
      binary = await fetchAtlassianAttachmentBinary(
        attempt.url,
        input.token,
        candidate?.mediaType || "image/*",
        fetcher,
        { cloudId: input.cloudId, pageId: input.pageId, attachmentId: attempt.attachmentId },
      );
      stages.push(...binary.trace.map((entry) => ({ stage: attempt.stage, ...entry })));
      if (binary.ok) break;
      if (input.stopOnRateLimit && (binary.status === 429 || binary.trace.some((entry) => entry.status === 429))) {
        rateLimited = true;
        break;
      }
    }
    if (!binary?.ok) {
      // optional metadataを含む過去の失敗ではなく、最後まで試した取得経路を根本原因にする。
      const decisiveCode = binary?.code;
      const final = attempts.length ? failureCode(decisiveCode ?? "ATTACHMENT_DOWNLOAD_FAILED") : "source_untrusted";
      failures.push(final); diagnostics.push({ image: index + 1, stages, final, finalCode: decisiveCode });
      if (rateLimited) break;
      continue;
    }
    const filename = candidate?.title || reference.filename || "confluence-image";
    const asset: SnapshotImage = {
      assetKey: crypto.randomUUID().replaceAll("-", ""),
      filename,
      mime: binary.mediaType,
      bytes: binary.bytes,
      sha256: await sha256(binary.bytes),
      reference,
    };
    // Bulk imports persist each image before fetching the next one, keeping memory
    // bounded by one image rather than the size of the entire Confluence page.
    if (input.onAsset) await input.onAsset(asset);
    if (input.retainAssets !== false) assets.push(asset);
    diagnostics.push({ image: index + 1, stages, final: "saved" });
  }
  return { references, assets, failures, diagnostics, warnings };
}

export const SNAPSHOT_FAILURE_MESSAGES: Record<SnapshotFailureCode, string> = {
  scope_missing: "Atlassianの画像権限を再承認してください。",
  source_untrusted: "安全な取得経路を確認できない画像がありました。",
  fetch_failed: "Confluence画像の取得処理に失敗しました。",
  too_large: "10MiBを超える画像は保存できません。",
  unsupported_mime: "対応していない画像形式がありました。",
};
