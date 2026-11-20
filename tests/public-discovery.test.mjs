import assert from "node:assert/strict";
import test from "node:test";
import { robotsResponse, sitemapResponse } from "../lib/public-discovery.ts";

test("crawler discovery includes only the public homepage and excludes private app routes", async () => {
  const robots = robotsResponse();
  assert.equal(robots.status, 200);
  assert.match(robots.headers.get("content-type"), /^text\/plain/);
  const rules = await robots.text();
  for (const prefix of ["/w/", "/apps/", "/api/", "/lllm-assets/"]) {
    assert.ok(rules.split("\n").includes(`Disallow: ${prefix}`));
  }
  assert.match(rules, /^Sitemap: https:\/\/game-canvas\.app\/sitemap\.xml$/m);

  const sitemap = sitemapResponse();
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.headers.get("content-type"), /^application\/xml/);
  const xml = await sitemap.text();
  assert.deepEqual([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]), ["https://game-canvas.app/"]);
  assert.doesNotMatch(xml, /\/w\/|\/apps\/|\/api\/|minamomura|workspace-|account|member|token/i);
  assert.equal(sitemap.headers.get("set-cookie"), null);
});
