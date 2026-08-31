import test from "node:test";
import assert from "node:assert/strict";
import { aggregateResolverDiagnostics } from "../lib/confluence-diagnostics.ts";
import { fetchConfluenceImageSnapshots } from "../lib/confluence-snapshot.ts";

const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const pageId = "19791960";

type Observation = { path: string; queryNames: string[]; auth: boolean };

function item(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `att:${index}`,
    pageId,
    title: `image-${index}.png`,
    mediaType: "image/png",
    fileId: `file-${index}`,
    fileSize: 8,
    downloadLink: `/wiki/download/attachments/${pageId}/image-${index}.png`,
    ...overrides,
  };
}

function snapshotFetcher(options: {
  count?: number;
  incomplete?: boolean;
  metadataStatus?: number;
  v1Status?: number;
  thumbnailStatus?: number;
  downloadStatus?: number;
}, observations: Observation[]) {
  const count = options.count ?? 1;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    observations.push({
      path: url.pathname,
      queryNames: [...url.searchParams.keys()].sort(),
      auth: new Headers(init?.headers).has("authorization"),
    });
    if (url.pathname.endsWith(`/pages/${pageId}/attachments`)) {
      return Response.json({ results: Array.from({ length: count }, (_, index) => options.incomplete
        ? item(index, { title: "", mediaType: "", fileSize: undefined, downloadLink: "" })
        : item(index)) });
    }
    if (/\/wiki\/api\/v2\/attachments\/att%3A\d+$/.test(url.pathname)) {
      const encoded = url.pathname.split("/").at(-1)!;
      const index = Number(decodeURIComponent(encoded).split(":")[1]);
      if ((options.metadataStatus ?? 200) !== 200)
        return new Response("failure", { status: options.metadataStatus });
      return Response.json(item(index));
    }
    if (url.pathname.includes("/child/attachment/")) {
      if (options.v1Status) return new Response("failure", { status: options.v1Status });
      return new Response(null, { status: 302, headers: { location: `https://api.media.atlassian.com/file/${url.pathname.split("/").at(-2)}/binary` } });
    }
    if (url.pathname.includes("/thumbnail/download")) {
      if (options.thumbnailStatus) return new Response("failure", { status: options.thumbnailStatus });
      return new Response(null, { status: 302, headers: { location: "https://api.media.atlassian.com/file/thumb/binary" } });
    }
    if (url.pathname.includes("/wiki/download/attachments/"))
      return options.downloadStatus
        ? new Response("failure", { status: options.downloadStatus })
        : new Response(null, { status: 302, headers: { location: "https://api.media.atlassian.com/file/link/binary" } });
    if (url.hostname === "api.media.atlassian.com")
      return new Response(PNG, { headers: { "content-type": "application/octet-stream" } });
    throw new Error(`unexpected request category: ${url.pathname}`);
  }) as typeof fetch;
}

function references(count = 1) {
  return [Array.from({ length: count }, (_, index) => ({
    filename: `image-${index}.png`,
    normalizedFilename: `image-${index}.png`,
    fileId: `file-${index}`,
  }))];
}

test("list 200 full itemはmetadata supplementを呼ばずv1→CDNで成功する", async () => {
  const observations: Observation[] = [];
  const result = await fetchConfluenceImageSnapshots({
    cloudId: "cloud", cloudUrl: "https://tenant.atlassian.net", pageId, token: "token",
    representations: references(), fetcher: snapshotFetcher({ metadataStatus: 500 }, observations),
  });
  assert.equal(result.assets.length, 1);
  assert.equal(result.failures.length, 0);
  assert.equal(observations.filter((entry) => /\/api\/v2\/attachments\/att/.test(entry.path)).length, 0);
});

test("list 200 full itemではmetadata 404に依存せずthumbnail fallbackで成功する", async () => {
  const observations: Observation[] = [];
  const result = await fetchConfluenceImageSnapshots({
    cloudId: "cloud", cloudUrl: "https://tenant.atlassian.net", pageId, token: "token",
    representations: references(), fetcher: snapshotFetcher({ metadataStatus: 404, v1Status: 500 }, observations),
  });
  assert.equal(result.assets.length, 1);
  assert.ok(result.diagnostics[0].stages.some((stage) => stage.stage === "v2_thumbnail_download"));
});

test("list item fields不足時だけmetadata 200で安全に補足する", async () => {
  const observations: Observation[] = [];
  const result = await fetchConfluenceImageSnapshots({
    cloudId: "cloud", cloudUrl: "https://tenant.atlassian.net", pageId, token: "token",
    representations: references(), fetcher: snapshotFetcher({ incomplete: true }, observations),
  });
  assert.equal(result.assets.length, 1);
  const metadata = observations.find((entry) => /\/api\/v2\/attachments\/att/.test(entry.path));
  assert.ok(metadata);
  assert.deepEqual(metadata?.queryNames, []);
});

test("optional metadata 500はwarningに残すがv1成功をエラーにしない", async () => {
  const observations: Observation[] = [];
  const result = await fetchConfluenceImageSnapshots({
    cloudId: "cloud", cloudUrl: "https://tenant.atlassian.net", pageId, token: "token",
    representations: references(), fetcher: snapshotFetcher({ incomplete: true, metadataStatus: 500 }, observations),
  });
  assert.equal(result.assets.length, 1);
  assert.equal(result.failures.length, 0);
  assert.equal(result.warnings[0]?.status, 500);
  assert.equal(result.warnings[0]?.idCategory, "attachment_id");
});

test("attachment id・fileId・mediaIdを混同せずcanonical idをdownloadへ使う", async () => {
  const observations: Observation[] = [];
  const result = await fetchConfluenceImageSnapshots({
    cloudId: "cloud", cloudUrl: "https://tenant.atlassian.net", pageId, token: "token",
    representations: [[{
      filename: "image-0.png", normalizedFilename: "image-0.png",
      attachmentId: "media-0", fileId: "file-0",
    }]],
    fetcher: snapshotFetcher({}, observations),
  });
  assert.equal(result.assets.length, 1);
  const v1 = observations.find((entry) => entry.path.includes("/child/attachment/"));
  assert.match(v1?.path ?? "", /\/att%3A0\/download$/);
  assert.doesNotMatch(v1?.path ?? "", /file-0|media-0/);
});

test("attachment idは文字列を維持しURL encodeは一度だけ行う", async () => {
  const observations: Observation[] = [];
  await fetchConfluenceImageSnapshots({
    cloudId: "cloud", cloudUrl: "https://tenant.atlassian.net", pageId, token: "token",
    representations: references(), fetcher: snapshotFetcher({}, observations),
  });
  const v1 = observations.find((entry) => entry.path.includes("/child/attachment/"));
  assert.match(v1?.path ?? "", /\/att%3A0\/download$/);
  assert.doesNotMatch(v1?.path ?? "", /%253A/);
});

test("全fallbackが5xxのときだけIMG-UPSTREAM-5XXを最終原因にする", async () => {
  const observations: Observation[] = [];
  const result = await fetchConfluenceImageSnapshots({
    cloudId: "cloud", cloudUrl: "https://tenant.atlassian.net", pageId, token: "token",
    representations: references(),
    fetcher: snapshotFetcher({ v1Status: 500, thumbnailStatus: 502, downloadStatus: 503 }, observations),
  });
  const root = aggregateResolverDiagnostics(result.diagnostics, result.references.length);
  assert.equal(result.assets.length, 0);
  assert.equal(root?.code, "IMG-UPSTREAM-5XX");
  assert.notEqual(root?.requestStage, "attachment_metadata");
});

test("5画像でもattachment listは1回、metadataは省略、v1は各1回", async () => {
  const observations: Observation[] = [];
  const result = await fetchConfluenceImageSnapshots({
    cloudId: "cloud", cloudUrl: "https://tenant.atlassian.net", pageId, token: "token",
    representations: references(5), fetcher: snapshotFetcher({ count: 5 }, observations),
  });
  assert.equal(result.assets.length, 5);
  assert.equal(observations.filter((entry) => entry.path.endsWith(`/pages/${pageId}/attachments`)).length, 1);
  assert.equal(observations.filter((entry) => /\/api\/v2\/attachments\/att/.test(entry.path)).length, 0);
  assert.equal(observations.filter((entry) => entry.path.includes("/child/attachment/")).length, 5);
});
