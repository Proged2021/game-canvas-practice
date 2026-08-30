import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("OAuth status is secret-safe and uses the exact production callback", async () => {
  const [confluence, status, start] = await Promise.all([read("lib/confluence.ts"), read("app/api/workspaces/[slug]/confluence/status/route.ts"), read("app/api/workspaces/[slug]/confluence/start/route.ts")]);
  assert.match(confluence, /ATLASSIAN_CLIENT_ID/);
  assert.match(confluence, /ATLASSIAN_CLIENT_SECRET/);
  assert.match(confluence, /game-design-workspace\.naoki-takehara111\.chatgpt\.site\/api\/confluence\/callback/);
  assert.match(status, /publicConfluenceStatus/);
  assert.doesNotMatch(status, /clientSecret|access_token|refresh_token/);
  assert.match(start, /getRandomValues\(new Uint8Array\(32\)\)/);
  assert.match(start, /read:page:confluence offline_access|CONFLUENCE_SCOPES/);
  assert.match(start, /Confluence連携は未設定です/);
});

test("OAuth callback consumes state once and validates expiry, user, owner and cancellation", async () => {
  const callback = await read("app/api/confluence/callback/route.ts");
  assert.match(callback, /DELETE FROM oauth_states WHERE state=\?1 RETURNING/);
  assert.match(callback, /Date\.parse\(record\.expires_at\) <= Date\.now\(\)/);
  assert.match(callback, /record\.user_email\.toLowerCase\(\) !== user\.email\.toLowerCase\(\)/);
  assert.match(callback, /membership\?\.role !== "owner"/);
  assert.match(callback, /url\.searchParams\.get\("error"\)/);
  assert.match(callback, /accessible-resources/);
  assert.doesNotMatch(callback, /token\.access_token[^\n]*Response\.json/);
});

test("sync uses v2 view format, safe errors and server-side token access", async () => {
  const sync = await read("app/api/workspaces/[slug]/confluence/sync/route.ts");
  assert.match(sync, /wiki\/api\/v2\/pages/);
  assert.match(sync, /body-format=view/);
  assert.match(sync, /atlassianError\(response\.status\)/);
  assert.match(sync, /authorizeWorkspace\(slug, checkOnly \? undefined : \["owner", "editor"\]\)/);
});

test("invitations are owner-only, pending records and never fake Site sharing", async () => {
  const [route, client, schema] = await Promise.all([read("app/api/workspaces/[slug]/members/route.ts"), read("components/workspace-client.tsx"), read("db/schema.ts")]);
  assert.match(route, /authorizeWorkspace\([^\n]+\["owner"\]\)/);
  assert.match(route, /自分自身を招待することはできません/);
  assert.match(route, /既に招待があります/);
  assert.match(route, /body\.role !== "editor" && body\.role !== "viewer"/);
  assert.match(route, /status='cancelled'/);
  assert.match(schema, /workspaceInvitations/);
  assert.match(client, /①このアプリ内で招待/);
  assert.match(client, /②Siteの「共有」/);
  assert.doesNotMatch(route, /sendMail|update_site_access/i);
});
