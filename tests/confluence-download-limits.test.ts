import assert from "node:assert/strict";
import test from "node:test";
import { fetchAtlassianAttachmentBinary } from "../lib/confluence-image.ts";
import { MAX_CONFLUENCE_IMAGE_BYTES } from "../lib/confluence-safe.ts";

const url = "https://api.atlassian.com/ex/confluence/cloud/wiki/download/attachments/42/image.png";
const context = { cloudId: "cloud", pageId: "42" };
const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const invoke = (response: Response) => fetchAtlassianAttachmentBinary(url, "synthetic-token", "image/png",
  (async () => response) as typeof fetch, context);

for (const declaredLength of [undefined, "8"]) {
  test(`oversized image stops and cancels the stream with Content-Length ${declaredLength ?? "absent"}`, async () => {
    let cancelled = false, pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        const bytes = new Uint8Array(1024 * 1024);
        if (pulls === 1) bytes.set(signature);
        controller.enqueue(bytes);
        if (pulls > 30) throw new Error("The downloader consumed an unbounded body");
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const headers = new Headers({ "content-type": "image/png" });
    if (declaredLength) headers.set("content-length", declaredLength);
    const result = await invoke(new Response(body, { headers }));
    assert.equal(result.ok, false);
    if (!result.ok) { assert.equal(result.code, "ATTACHMENT_TOO_LARGE"); assert.equal(result.status, 413); }
    assert.equal(pulls, 11);
    assert.equal(cancelled, true);
  });
}

test("an image exactly at the limit still downloads with its binary signature intact", async () => {
  const bytes = new Uint8Array(MAX_CONFLUENCE_IMAGE_BYTES);
  bytes.set(signature);
  const result = await invoke(new Response(bytes, { headers: { "content-type": "image/png" } }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.bytes.byteLength, MAX_CONFLUENCE_IMAGE_BYTES);
    assert.deepEqual(new Uint8Array(result.bytes).slice(0, 8), signature);
  }
});

test("an oversized declared length is rejected without reading the body", async () => {
  let pulls = 0, cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull() { pulls++; throw new Error("The oversized body must not be read"); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const result = await invoke(new Response(body, { headers: {
    "content-type": "image/png", "content-length": String(MAX_CONFLUENCE_IMAGE_BYTES + 1),
  } }));
  assert.equal(result.ok, false);
  assert.equal(pulls, 0);
  assert.equal(cancelled, true);
});

test("redirect response bodies are cancelled before following the trusted CDN", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
    status: 302, headers: { location: "https://api.media.atlassian.com/file/image" },
  });
  let calls = 0;
  const result = await fetchAtlassianAttachmentBinary(url, "synthetic-token", "image/png",
    (async (_input, init) => {
      if (++calls === 1) return response;
      assert.equal(cancelled, true);
      assert.equal(new Headers(init?.headers).has("authorization"), false);
      return new Response(signature, { headers: { "content-type": "image/png" } });
    }) as typeof fetch, context);
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});
