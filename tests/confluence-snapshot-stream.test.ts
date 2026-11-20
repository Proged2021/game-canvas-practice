import test from "node:test";
import assert from "node:assert/strict";
import { dedupeConfluenceImageReferences, fetchConfluenceImageSnapshots } from "../lib/confluence-snapshot.ts";
import type { ConfluenceImageReference } from "../lib/confluence-safe.ts";

const pageId = "19791960";
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const connection = { cloudId: "cloud", cloudUrl: "https://tenant.atlassian.net", pageId, token: "test-token" };

function attachment(id: string, filename: string, fileId = `file-${id}`) {
  return { id, pageId, title: filename, fileId, mediaType: "image/png", fileSize: png.byteLength,
    downloadLink: `/wiki/download/attachments/${pageId}/${encodeURIComponent(filename)}` };
}

function reference(filename: string, ids: { attachmentId?: string; fileId?: string } = {}): ConfluenceImageReference {
  return { filename, normalizedFilename: filename.toLowerCase(), ...ids };
}

function imageFetcher(attachments: ReturnType<typeof attachment>[], requests: string[] = []) {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    if (url.pathname.endsWith(`/pages/${pageId}/attachments`)) return Response.json({ results: attachments });
    if (url.pathname.includes("/child/attachment/"))
      return new Response(Uint8Array.from(png), { headers: { "content-type": "image/png" } });
    throw new Error(`unexpected request category: ${url.pathname}`);
  }) as typeof fetch;
}

test("exact attachment ID outranks a same-name attachment listed first", async () => {
  const requests: string[] = [];
  const result = await fetchConfluenceImageSnapshots({ ...connection,
    representations: [[reference("shared.png", { attachmentId: "wanted" })]],
    fetcher: imageFetcher([attachment("wrong", "shared.png"), attachment("wanted", "shared.png")], requests),
  });
  assert.equal(result.assets.length, 1);
  assert.deepEqual(result.failures, []);
  assert.ok(requests.some((path) => path.endsWith("/child/attachment/wanted/download")));
  assert.ok(!requests.some((path) => path.includes("/child/attachment/wrong/")));
});

test("exact file ID outranks filename and resolves media IDs to the canonical attachment ID", async () => {
  const requests: string[] = [];
  const result = await fetchConfluenceImageSnapshots({ ...connection,
    representations: [[reference("shared.png", { attachmentId: "media-wanted", fileId: "media-wanted" })]],
    fetcher: imageFetcher([
      attachment("wrong", "shared.png", "media-wrong"),
      attachment("wanted", "shared.png", "media-wanted"),
    ], requests),
  });
  assert.equal(result.assets.length, 1);
  assert.ok(requests.some((path) => path.endsWith("/child/attachment/wanted/download")));
  assert.ok(!requests.some((path) => path.includes("/child/attachment/wrong/")));
});

test("filename fallback remains available when exactly one canonical attachment matches", async () => {
  const result = await fetchConfluenceImageSnapshots({ ...connection,
    representations: [[reference("image.png", { attachmentId: "unresolved-media-id" })]],
    fetcher: imageFetcher([attachment("canonical", "image.png")]),
  });
  assert.equal(result.assets.length, 1);
  assert.deepEqual(result.failures, []);
});

test("ambiguous filenames do not download any candidate or bypass via a body URL", async () => {
  const requests: string[] = [];
  const result = await fetchConfluenceImageSnapshots({ ...connection,
    representations: [[{ ...reference("shared.png"),
      sourceUrl: `https://tenant.atlassian.net/wiki/download/attachments/${pageId}/shared.png` }]],
    fetcher: imageFetcher([attachment("first", "shared.png"), attachment("second", "shared.png")], requests),
  });
  assert.equal(requests.length, 1);
  assert.deepEqual(result.assets, []);
  assert.deepEqual(result.failures, ["source_untrusted"]);
  assert.equal(result.diagnostics[0].finalCode, "ATTACHMENT_AMBIGUOUS");
});

test("conflicting strong IDs sharing a filename stay separate across representations", () => {
  const result = dedupeConfluenceImageReferences(pageId, [
    [reference("shared.png", { attachmentId: "first" })],
    [reference("shared.png", { attachmentId: "second" })],
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((item) => item.attachmentId), ["first", "second"]);
});

test("a weak reference is never attached arbitrarily to conflicting strong identities", () => {
  for (const values of [
    [reference("shared.png"), reference("shared.png", { fileId: "one" }), reference("shared.png", { fileId: "two" })],
    [reference("shared.png", { fileId: "one" }), reference("shared.png", { fileId: "two" }), reference("shared.png")],
  ]) {
    const result = dedupeConfluenceImageReferences(pageId, [values]);
    assert.equal(result.length, 3);
    assert.equal(result.filter((item) => !item.fileId).length, 1);
  }
});

test("exact strong identity still deduplicates repeated image occurrences", async () => {
  const requests: string[] = [];
  const ref = reference("shared.png", { attachmentId: "one" });
  const result = await fetchConfluenceImageSnapshots({ ...connection,
    representations: [[ref, { ...ref }]],
    fetcher: imageFetcher([attachment("one", "shared.png")], requests),
  });
  assert.equal(result.references.length, 1);
  assert.equal(result.assets.length, 1);
  assert.equal(requests.filter((path) => path.includes("/child/attachment/")).length, 1);
});

test("stream callback finishes before fetching the next binary and retainAssets=false retains none", async () => {
  const events: string[] = [];
  let activeCallbacks = 0;
  let peakCallbacks = 0;
  const fetcher = imageFetcher([attachment("one", "one.png"), attachment("two", "two.png")]);
  const result = await fetchConfluenceImageSnapshots({ ...connection,
    representations: [[reference("one.png"), reference("two.png")]],
    retainAssets: false,
    fetcher: (async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.includes("/child/attachment/")) {
        assert.equal(activeCallbacks, 0);
        events.push(path.includes("/one/") ? "download-one" : "download-two");
      }
      return fetcher(input, init);
    }) as typeof fetch,
    onAsset: async (asset) => {
      activeCallbacks += 1;
      peakCallbacks = Math.max(peakCallbacks, activeCallbacks);
      events.push(`start-${asset.filename}`);
      await Promise.resolve();
      events.push(`done-${asset.filename}`);
      activeCallbacks -= 1;
    },
  });
  assert.equal(peakCallbacks, 1);
  assert.deepEqual(events, ["download-one", "start-one.png", "done-one.png", "download-two", "start-two.png", "done-two.png"]);
  assert.deepEqual(result.assets, []);
  assert.deepEqual(result.failures, []);
  assert.ok(result.diagnostics.every((diagnostic) => diagnostic.final === "saved"));
});

test("stream callback retains assets by default for existing callers", async () => {
  const called: string[] = [];
  const result = await fetchConfluenceImageSnapshots({ ...connection,
    representations: [[reference("image.png")]],
    fetcher: imageFetcher([attachment("one", "image.png")]),
    onAsset: async (asset) => { called.push(asset.assetKey); },
  });
  assert.equal(result.assets.length, 1);
  assert.deepEqual(called, [result.assets[0].assetKey]);
});

test("persistence failure stops streaming before another image is fetched", async () => {
  const requests: string[] = [];
  const failure = new Error("persistence failed");
  await assert.rejects(fetchConfluenceImageSnapshots({ ...connection,
    representations: [[reference("one.png"), reference("two.png")]],
    fetcher: imageFetcher([attachment("one", "one.png"), attachment("two", "two.png")], requests),
    retainAssets: false,
    onAsset: async () => { throw failure; },
  }), (error) => error === failure);
  assert.equal(requests.filter((path) => path.includes("/child/attachment/")).length, 1);
});

test("stopOnRateLimit stops fallback attempts and subsequent images after a binary 429", async () => {
  const requests: string[] = [];
  const base = imageFetcher([attachment("one", "one.png"), attachment("two", "two.png")]);
  const result = await fetchConfluenceImageSnapshots({ ...connection,
    representations: [[reference("one.png"), reference("two.png")]],
    stopOnRateLimit: true,
    fetcher: (async (input, init) => {
      const path = new URL(String(input)).pathname;
      requests.push(path);
      return path.includes("/child/attachment/") ? new Response("rate limited", { status: 429 }) : base(input, init);
    }) as typeof fetch,
  });
  assert.equal(requests.length, 2);
  assert.deepEqual(result.assets, []);
  assert.deepEqual(result.failures, ["fetch_failed"]);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].stages.at(-1)?.status, 429);
});

test("stopOnRateLimit also stops at optional metadata 429", async () => {
  const requests: string[] = [];
  const result = await fetchConfluenceImageSnapshots({ ...connection,
    representations: [[reference("one.png", { attachmentId: "one" }), reference("two.png")]],
    stopOnRateLimit: true,
    fetcher: (async (input) => {
      const path = new URL(String(input)).pathname;
      requests.push(path);
      if (path.endsWith(`/pages/${pageId}/attachments`)) return Response.json({ results: [
        { ...attachment("one", "one.png"), mediaType: "", downloadLink: "" }, attachment("two", "two.png"),
      ] });
      return new Response("rate limited", { status: 429 });
    }) as typeof fetch,
  });
  assert.equal(requests.length, 2);
  assert.deepEqual(result.failures, ["fetch_failed"]);
  assert.equal(result.diagnostics[0].finalCode, "ATTACHMENT_RATE_LIMITED");
  assert.equal(result.diagnostics[0].stages.at(-1)?.status, 429);
});

test("existing callers still try a thumbnail after 429 unless stopOnRateLimit is enabled", async () => {
  const requests: string[] = [];
  const base = imageFetcher([attachment("one", "one.png")]);
  const result = await fetchConfluenceImageSnapshots({ ...connection,
    representations: [[reference("one.png")]],
    fetcher: (async (input, init) => {
      const path = new URL(String(input)).pathname;
      requests.push(path);
      if (path.includes("/child/attachment/")) return new Response("rate limited", { status: 429 });
      if (path.includes("/thumbnail/download")) return new Response(Uint8Array.from(png), { headers: { "content-type": "image/png" } });
      return base(input, init);
    }) as typeof fetch,
  });
  assert.equal(result.assets.length, 1);
  assert.deepEqual(result.failures, []);
  assert.ok(requests.some((path) => path.includes("/thumbnail/download")));
});
