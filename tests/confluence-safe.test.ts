import assert from "node:assert/strict";
import test from "node:test";
import { atlassianError, buildAtlassianAuthorizeUrl, parseConfluencePage, sanitizeConfluenceHtml } from "../lib/confluence-safe.ts";
import { CONFLUENCE_CALLBACK_URL } from "../lib/site-urls.ts";

test("builds the Atlassian authorization redirect without exposing a client secret", () => {
  const url = buildAtlassianAuthorizeUrl("public-client-id", CONFLUENCE_CALLBACK_URL, "opaque-state");
  assert.equal(url.origin, "https://auth.atlassian.com");
  assert.equal(url.pathname, "/authorize");
  assert.equal(url.searchParams.get("client_id"), "public-client-id");
  assert.equal(url.searchParams.get("redirect_uri"), "https://game-canvas.app/api/confluence/callback");
  assert.equal(url.searchParams.get("state"), "opaque-state");
  assert.deepEqual(new Set(url.searchParams.get("scope")?.split(" ")), new Set(["read:page:confluence", "offline_access"]));
  assert.equal(url.searchParams.has("client_secret"), false);
});

test("validates Confluence page IDs and URLs strictly", () => {
  assert.deepEqual(parseConfluencePage("12345"), { pageId: "12345", originalUrl: null });
  assert.equal(parseConfluencePage("http://team.atlassian.net/wiki/spaces/A/pages/123"), null);
  assert.equal(parseConfluencePage("https://evil.example/wiki/pages/123"), null);
  assert.equal(parseConfluencePage("https://team.atlassian.net/wiki/spaces/A/pages/not-a-number"), null);
  assert.equal(parseConfluencePage("https://user:pass@team.atlassian.net/wiki/pages/123"), null);
  assert.equal(parseConfluencePage("https://team.atlassian.net:8443/wiki/pages/123"), null);
  assert.equal(parseConfluencePage("https://team.atlassian.net/not-wiki/pages/123"), null);
  assert.equal(parseConfluencePage("https://team.atlassian.net/wiki/spaces/A/pages/123/title")?.pageId, "123");
});

test("sanitizes view HTML and preserves safe structure and relative resources", () => {
  const clean = sanitizeConfluenceHtml(`<script>alert(1)</script><h2 onclick="bad()">見出し</h2><ul><li>項目</li></ul><table><tbody><tr><td>表</td></tr></tbody></table><a href="/wiki/x" onmouseover="bad()">リンク</a><img src="/img.png" onerror="bad()"><a href="javascript:bad()">危険</a>`, "https://team.atlassian.net/wiki/");
  assert.doesNotMatch(clean, /script|onclick|onmouseover|onerror|javascript:/i);
  assert.match(clean, /<h2>見出し<\/h2>/);
  assert.match(clean, /<ul><li>項目<\/li><\/ul>/);
  assert.match(clean, /<table>/);
  assert.match(clean, /href="https:\/\/team\.atlassian\.net\/wiki\/x"/);
  assert.match(clean, /src="https:\/\/team\.atlassian\.net\/img\.png"/);
  assert.doesNotMatch(sanitizeConfluenceHtml(`<img src="data:image/png;base64,AAAA"><a href="data:text/html,bad">bad</a>`, "https://team.atlassian.net/wiki/"), /data:/i);
});

test("maps mocked Atlassian statuses to safe Japanese messages", () => {
  assert.match(atlassianError(403), /権限/);
  assert.match(atlassianError(404), /見つかりません/);
  assert.match(atlassianError(429), /利用上限/);
  assert.match(atlassianError(503), /Atlassian側/);
});
