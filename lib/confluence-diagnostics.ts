import type { AttachmentBinaryResult } from "./confluence-image.ts";

export type DiagnosticStage =
  | "token"
  | "accessible_resources"
  | "page"
  | "attachment_list"
  | "attachment_metadata"
  | "v1_download"
  | "thumbnail_download"
  | "image_cdn";

export type DiagnosticReason =
  | "token_missing"
  | "token_decrypt_failed"
  | "token_invalid"
  | "scope_or_site_permission"
  | "endpoint_or_id_mismatch"
  | "rate_limited"
  | "atlassian_unavailable"
  | "cloud_mismatch"
  | "attachment_not_found"
  | "redirect_missing"
  | "redirect_untrusted"
  | "cdn_fetch_failed"
  | "invalid_image_response";

export type SafeImageDiagnostic = {
  code: string;
  stage: string;
  requestStage: DiagnosticStage;
  httpStatus: number | null;
  hostCategory: string;
  finalReason: DiagnosticReason;
  logicalImageCount: number;
};

export type SafeDiagnosticWarning = {
  requestStage: "attachment_metadata";
  status: number;
  hostCategory: "oauth_gateway";
  pathTemplate: "/wiki/api/v2/attachments/{attachment_id}";
  queryNames: [];
  idCategory: "attachment_id";
  optional: true;
};

export type CapabilityPage = {
  id: string;
  title: string;
  version: { number: number };
  body?: { view?: { value?: string }; storage?: { value?: string } };
  _links?: { webui?: string };
};

const STAGE_LABELS: Record<DiagnosticStage, string> = {
  token: "トークン",
  accessible_resources: "接続先確認",
  page: "ページ本文",
  attachment_list: "添付一覧",
  attachment_metadata: "添付情報",
  v1_download: "ダウンロード転送",
  thumbnail_download: "サムネイル取得",
  image_cdn: "画像配信先",
};

function makeDiagnostic(
  code: string,
  requestStage: DiagnosticStage,
  httpStatus: number | null,
  hostCategory: string,
  finalReason: DiagnosticReason,
  logicalImageCount = 0,
): SafeImageDiagnostic {
  return { code, stage: STAGE_LABELS[requestStage], requestStage, httpStatus, hostCategory, finalReason, logicalImageCount };
}

export function classifyAtlassianStatus(
  requestStage: DiagnosticStage,
  status: number,
  hostCategory = "oauth_gateway",
  logicalImageCount = 0,
): SafeImageDiagnostic | null {
  if (status < 400) return null;
  if (status === 401) return makeDiagnostic("IMG-TOKEN-401", requestStage, status, hostCategory, "token_invalid", logicalImageCount);
  if (status === 403) return makeDiagnostic("IMG-AUTH-403", requestStage, status, hostCategory, "scope_or_site_permission", logicalImageCount);
  if (status === 404) return makeDiagnostic("IMG-ID-404", requestStage, status, hostCategory, "endpoint_or_id_mismatch", logicalImageCount);
  if (status === 429) return makeDiagnostic("IMG-RATE-429", requestStage, status, hostCategory, "rate_limited", logicalImageCount);
  if (status >= 500) return makeDiagnostic("IMG-UPSTREAM-5XX", requestStage, status, hostCategory, "atlassian_unavailable", logicalImageCount);
  return makeDiagnostic("IMG-UPSTREAM-OTHER", requestStage, status, hostCategory, "cdn_fetch_failed", logicalImageCount);
}

export function classifyBinaryFailure(
  requestStage: "v1_download" | "thumbnail_download",
  result: Exclude<AttachmentBinaryResult, { ok: true }>,
  logicalImageCount = 0,
): SafeImageDiagnostic {
  const last = result.trace.at(-1);
  const category = last?.hostCategory ?? "oauth_gateway";
  const actualStatus = last?.status ?? result.status;
  if (actualStatus === 401 && last?.sentAuthorization === false)
    return makeDiagnostic("IMG-CDN-401", "image_cdn", actualStatus, category, "cdn_fetch_failed", logicalImageCount);
  if (actualStatus === 403 && last?.sentAuthorization === false)
    return makeDiagnostic("IMG-CDN-403", "image_cdn", actualStatus, category, "cdn_fetch_failed", logicalImageCount);
  const http = classifyAtlassianStatus(
    category === "oauth_gateway" ? requestStage : "image_cdn",
    actualStatus,
    category,
    logicalImageCount,
  );
  if (http) return http;
  if (result.code === "DOWNLOAD_REDIRECT_MISSING")
    return makeDiagnostic("IMG-REDIRECT-EMPTY", requestStage, actualStatus || null, category, "redirect_missing", logicalImageCount);
  if (["DOWNLOAD_REDIRECT_UNSAFE", "UNSAFE_DOWNLOAD_URL", "DOWNLOAD_REDIRECT_LIMIT"].includes(result.code))
    return makeDiagnostic("IMG-REDIRECT-UNTRUSTED", requestStage, actualStatus || null, category, "redirect_untrusted", logicalImageCount);
  if (result.code === "ATTACHMENT_BINARY_UNSAFE")
    return makeDiagnostic("IMG-RESPONSE-INVALID", category === "oauth_gateway" ? requestStage : "image_cdn", actualStatus || null, category, "invalid_image_response", logicalImageCount);
  return makeDiagnostic("IMG-CDN-FETCH", category === "oauth_gateway" ? requestStage : "image_cdn", actualStatus || null, category, "cdn_fetch_failed", logicalImageCount);
}

export function withLogicalImageCount(diagnostic: SafeImageDiagnostic, logicalImageCount: number) {
  return { ...diagnostic, logicalImageCount };
}

export function tokenDiagnostic(kind: "missing" | "decrypt_failed") {
  return kind === "missing"
    ? makeDiagnostic("IMG-TOKEN-MISSING", "token", null, "server", "token_missing")
    : makeDiagnostic("IMG-TOKEN-DECRYPT", "token", null, "server", "token_decrypt_failed");
}

export function diagnosticNeedsReconnect(diagnostic: SafeImageDiagnostic) {
  return diagnostic.finalReason === "token_invalid" || diagnostic.finalReason === "scope_or_site_permission";
}

export function diagnosticNextAction(diagnostic: SafeImageDiagnostic) {
  if (diagnosticNeedsReconnect(diagnostic))
    return "「Atlassianに再接続」を押して権限を再承認し、再同期してください。";
  if (diagnostic.finalReason === "rate_limited") return "数分待ってから同期を1回だけ実行してください。";
  if (diagnostic.finalReason === "atlassian_unavailable" || diagnostic.finalReason === "cdn_fetch_failed")
    return "Atlassianの復旧を待ってから、もう一度同期してください。";
  if (diagnostic.finalReason === "cloud_mismatch") return "接続中のConfluenceサイトとページURLのサイトが一致するか確認してください。";
  if (diagnostic.finalReason === "attachment_not_found") return "ページに画像添付が存在するか、画像が添付ファイルとして登録されているか確認してください。";
  if (diagnostic.finalReason === "endpoint_or_id_mismatch") return "ページまたは添付情報を再取得できませんでした。ページURLを確認して再同期してください。";
  if (diagnostic.finalReason === "invalid_image_response") return "画像形式を確認してください。PNG、JPEG、GIF、WebPに対応しています。";
  return "時間をおいてから、もう一度同期してください。";
}

export function aggregateResolverDiagnostics(
  diagnostics: Array<{
    stages: Array<{ stage: string; status: number; hostCategory: string; sentAuthorization?: boolean; signedQuery?: boolean }>;
    final: string;
    finalCode?: string;
  }>,
  logicalImageCount: number,
) {
  const failures = diagnostics.filter((item) => item.final !== "saved");
  if (!failures.length) return null;
  const mapped = failures.map((item) => {
    const failing = [...item.stages].reverse().find((stage) => stage.status >= 400)
      ?? item.stages.at(-1);
    const stageName = failing?.stage ?? "image_cdn";
    const requestStage: DiagnosticStage = stageName === "v2_filename_lookup" || stageName === "v2_attachment_list"
      ? "attachment_list"
      : stageName === "attachment_metadata"
        ? "attachment_metadata"
        : stageName === "v1_attachment_download"
          ? "v1_download"
          : stageName === "v2_thumbnail_download"
            ? "thumbnail_download"
            : "image_cdn";
    const status = failing?.status ?? 0;
    if (status === 401 && failing?.sentAuthorization === false)
      return makeDiagnostic("IMG-CDN-401", "image_cdn", status, failing.hostCategory, "cdn_fetch_failed", logicalImageCount);
    if (status === 403 && failing?.sentAuthorization === false)
      return makeDiagnostic("IMG-CDN-403", "image_cdn", status, failing.hostCategory, "cdn_fetch_failed", logicalImageCount);
    const byStatus = status ? classifyAtlassianStatus(requestStage, status, failing?.hostCategory ?? "unknown", logicalImageCount) : null;
    if (byStatus) return byStatus;
    if (item.finalCode === "DOWNLOAD_REDIRECT_MISSING")
      return makeDiagnostic("IMG-REDIRECT-EMPTY", requestStage, status || null, failing?.hostCategory ?? "unknown", "redirect_missing", logicalImageCount);
    if (["DOWNLOAD_REDIRECT_UNSAFE", "DOWNLOAD_REDIRECT_LIMIT", "DOWNLOAD_REDIRECT_LOOP", "UNSAFE_DOWNLOAD_URL"].includes(item.finalCode ?? "") || item.final === "source_untrusted")
      return makeDiagnostic("IMG-REDIRECT-UNTRUSTED", requestStage, status || null, failing?.hostCategory ?? "unknown", "redirect_untrusted", logicalImageCount);
    if (item.finalCode === "ATTACHMENT_BINARY_UNSAFE" || item.final === "unsupported_mime")
      return makeDiagnostic("IMG-RESPONSE-INVALID", requestStage, status || null, failing?.hostCategory ?? "unknown", "invalid_image_response", logicalImageCount);
    return makeDiagnostic("IMG-CDN-FETCH", requestStage, status || null, failing?.hostCategory ?? "unknown", "cdn_fetch_failed", logicalImageCount);
  });
  const groups = new Map<string, { diagnostic: SafeImageDiagnostic; count: number }>();
  for (const diagnostic of mapped) {
    const key = [diagnostic.code, diagnostic.requestStage, diagnostic.httpStatus, diagnostic.hostCategory, diagnostic.finalReason].join(":");
    const current = groups.get(key);
    groups.set(key, { diagnostic, count: (current?.count ?? 0) + 1 });
  }
  const root = [...groups.values()].sort((a, b) => b.count - a.count)[0].diagnostic;
  return { ...root, logicalImageCount };
}

type AccessibleResource = { id?: string; url?: string };

function sameSite(expected: string, actual?: string) {
  if (!actual) return true;
  try { return new URL(expected).origin.toLowerCase() === new URL(actual).origin.toLowerCase(); }
  catch { return false; }
}

export async function runConfluenceCapabilityDiagnostic(input: {
  cloudId: string;
  cloudUrl: string;
  pageId: string;
  token: string;
  fetcher?: typeof fetch;
}) {
  const fetcher = input.fetcher ?? fetch;
  const headers = { authorization: `Bearer ${input.token}`, accept: "application/json" };
  const resourcesResponse = await fetcher("https://api.atlassian.com/oauth/token/accessible-resources", { headers });
  const resourcesFailure = classifyAtlassianStatus("accessible_resources", resourcesResponse.status);
  if (resourcesFailure) return { ok: false as const, diagnostic: resourcesFailure };
  const resources = await resourcesResponse.json().catch(() => []) as AccessibleResource[];
  if (!Array.isArray(resources) || !resources.some((item) => item.id === input.cloudId && sameSite(input.cloudUrl, item.url)))
    return { ok: false as const, diagnostic: makeDiagnostic("IMG-SITE-MISMATCH", "accessible_resources", 200, "oauth_gateway", "cloud_mismatch") };

  const base = `https://api.atlassian.com/ex/confluence/${encodeURIComponent(input.cloudId)}`;
  const pageResponse = await fetcher(`${base}/wiki/api/v2/pages/${encodeURIComponent(input.pageId)}?body-format=view`, { headers });
  const pageFailure = classifyAtlassianStatus("page", pageResponse.status);
  if (pageFailure) return { ok: false as const, diagnostic: pageFailure };
  const page = await pageResponse.json() as CapabilityPage;

  const listResponse = await fetcher(`${base}/wiki/api/v2/pages/${encodeURIComponent(input.pageId)}/attachments?limit=1`, { headers });
  const listFailure = classifyAtlassianStatus("attachment_list", listResponse.status);
  if (listFailure) return { ok: false as const, page, diagnostic: listFailure };
  const listBody = await listResponse.json().catch(() => ({})) as { results?: Array<{ id?: string | number }> };
  const first = Array.isArray(listBody.results) ? listBody.results[0] : undefined;
  if (first?.id == null)
    return { ok: false as const, page, diagnostic: makeDiagnostic("IMG-ATTACHMENT-NONE", "attachment_list", 200, "oauth_gateway", "attachment_not_found") };
  // preflightはここで完了。metadata/binary/CDNは実画像resolverだけが評価する。
  return { ok: true as const, page, warnings: [] as SafeDiagnosticWarning[] };
}
