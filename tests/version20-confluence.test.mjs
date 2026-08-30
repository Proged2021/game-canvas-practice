import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseConfluencePage,
  resolveConfluenceShortUrl,
  sanitizeConfluenceHtmlWithAttachments,
} from "../lib/confluence-safe.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("accepts normal Confluence Cloud page URL variants", () => {
  const urls = [
    "https://team.atlassian.net/wiki/spaces/ABC/pages/123456/%E6%97%A5%E6%9C%AC%E8%AA%9E?src=share#section",
    "https://team.atlassian.net/spaces/ABC/pages/123456/%E6%97%A5%E6%9C%AC%E8%AA%9E/",
    "https://team.atlassian.net/wiki/pages/123456/title/",
    "https://team.atlassian.net/wiki/pages/viewpage.action?pageId=123456",
    "https://team.atlassian.net/wiki/spaces/ABC/overview?homepageId=123456#home",
  ];
  for (const url of urls) assert.equal(parseConfluencePage(url)?.pageId, "123456");
});

test("accepts tiny links but rejects lookalike hosts and unsafe URL parts", () => {
  assert.equal(parseConfluencePage("https://team.atlassian.net/wiki/x/AbC_12-")?.shortUrl, "https://team.atlassian.net/wiki/x/AbC_12-");
  assert.equal(parseConfluencePage("https://team.atlassian.net/x/AbC_12-/?src=share#x")?.pageId, null);
  assert.equal(parseConfluencePage("https://team.atlassian.net.evil.test/wiki/x/AbC"), null);
  assert.equal(parseConfluencePage("https://atlassian.net/wiki/spaces/A/pages/1"), null);
  assert.equal(parseConfluencePage("https://user:pass@team.atlassian.net/wiki/x/AbC"), null);
});

test("resolves tiny links only through same-host HTTPS redirects", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    return new Response(null, { status: 302, headers: { location: "/wiki/spaces/A/pages/987654/%E6%97%A5%E6%9C%AC%E8%AA%9E" } });
  };
  const result = await resolveConfluenceShortUrl("https://team.atlassian.net/wiki/x/AbC", "https://team.atlassian.net", fetcher);
  assert.equal(result.pageId, "987654");
  assert.equal(calls.length, 1);
  await assert.rejects(() => resolveConfluenceShortUrl("https://other.atlassian.net/wiki/x/AbC", "https://team.atlassian.net", fetcher));
});

test("rewrites safe Confluence images to a same-origin membership proxy", () => {
  const result = sanitizeConfluenceHtmlWithAttachments(
    '<p>本文<img src="/wiki/download/attachments/123/photo%20one.png" alt="説明" width="640" height="480"></p>',
    "https://team.atlassian.net",
    [{ id: "att-1", title: "photo one.png", pageId: "123", mediaType: "image/png", fileSize: 2048, downloadLink: "/wiki/download/attachments/123/photo%20one.png" }],
    "/api/workspaces/ws/confluence/pages/123/attachments",
  );
  assert.match(result.html, /src="\/api\/workspaces\/ws\/confluence\/pages\/123\/attachments\/att-1"/);
  assert.match(result.html, /alt="説明"/);
  assert.match(result.html, /width="640"/);
  assert.equal(result.missingImages, 0);
  assert.doesNotMatch(result.html, /atlassian\.net|Bearer|access_token/);
});

test("unsafe or unmatched images become harmless alternatives", () => {
  const result = sanitizeConfluenceHtmlWithAttachments(
    '<img src="/wiki/download/attachments/123/vector.svg" onerror="alert(1)">',
    "https://team.atlassian.net",
    [{ id: "bad", title: "vector.svg", pageId: "123", mediaType: "image/svg+xml", fileSize: 100, downloadLink: "/wiki/download/attachments/123/vector.svg" }],
    "/api/proxy",
  );
  assert.equal(result.missingImages, 1);
  assert.match(result.html, /画像を表示できません/);
  assert.doesNotMatch(result.html, /onerror|svg\+xml|\/api\/proxy\/bad/);
});

test("sync UI always reports progress, success, warnings and detailed failures", async () => {
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /if \(syncing \|\| !active\) return/);
  assert.match(client, /Confluenceを同期中です/);
  assert.match(client, /finally[\s\S]*setSyncing\(false\)/);
  assert.match(client, /本文と更新時刻を反映しました/);
  assert.match(client, /d\.nextAction/);
  assert.match(client, /role=\{syncFeedback\.type === "error" \? "alert" : "status"\}/);
});

test("attachment proxy enforces membership, page relation, MIME, size and safe headers", async () => {
  const proxy = await read("app/api/workspaces/[slug]/confluence/pages/[pageId]/attachments/[attachmentId]/route.ts");
  assert.match(proxy, /authorizeWorkspace\(slug\)/);
  assert.match(proxy, /workspace_id=\?1 AND page_id=\?2 AND attachment_id=\?3/);
  assert.match(proxy, /metadata\.pageId !== pageId/);
  assert.match(proxy, /SAFE_IMAGE_MEDIA_TYPES/);
  assert.match(proxy, /MAX_CONFLUENCE_IMAGE_BYTES/);
  assert.match(proxy, /"content-disposition": "inline"/);
  assert.match(proxy, /"x-content-type-options": "nosniff"/);
  assert.match(proxy, /"cache-control": "private, max-age=300"/);
  assert.doesNotMatch(proxy, /Response\.redirect/);
});

test("sync requests attachment scope and preserves the old snapshot on image failures", async () => {
  const [safe, sync, callback, attachments] = await Promise.all([
    read("lib/confluence-safe.ts"), read("app/api/workspaces/[slug]/confluence/sync/route.ts"), read("app/api/confluence/callback/route.ts"), read("lib/confluence-attachments.ts"),
  ]);
  assert.match(safe, /read:attachment:confluence/);
  assert.match(sync, /fetchConfluenceImageSnapshots/);
  assert.match(attachments, /pages\/\$\{encodeURIComponent\(pageId\)\}\/attachments\?limit=\$\{PAGE_LIMIT\}/);
  assert.match(sync, /前回の同期結果を保持しました/);
  assert.match(sync, /assets/);
  assert.match(callback, /attachment_scope_granted/);
});
