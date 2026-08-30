import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("OAuth status is secret-safe and uses the exact production callback", async () => {
  const [urls, confluence, status, start, callback] = await Promise.all([read("lib/site-urls.ts"), read("lib/confluence.ts"), read("app/api/workspaces/[slug]/confluence/status/route.ts"), read("app/api/workspaces/[slug]/confluence/start/route.ts"), read("app/api/confluence/callback/route.ts")]);
  assert.match(confluence, /ATLASSIAN_CLIENT_ID/);
  assert.match(confluence, /ATLASSIAN_CLIENT_SECRET/);
  assert.match(urls, /SITE_ORIGIN = "https:\/\/game-canvas\.app"/);
  assert.match(urls, /CONFLUENCE_CALLBACK_URL = `\$\{SITE_ORIGIN\}\/api\/confluence\/callback`/);
  assert.match(confluence, /redirectUri: CONFLUENCE_CALLBACK_URL/);
  assert.match(confluence, /redirect_uri: config\.redirectUri/);
  assert.match(callback, /new URL\(CONFLUENCE_CALLBACK_URL\)\.origin/);
  assert.match(status, /publicConfluenceStatus/);
  assert.match(confluence, /"unconfigured" \| "available" \| "connected" \| "reauth_required"/);
  assert.doesNotMatch(status, /clientSecret|access_token|refresh_token/);
  assert.match(start, /getRandomValues\(new Uint8Array\(32\)\)/);
  assert.match(start, /export async function GET/);
  assert.match(start, /Response\.redirect\(url\.toString\(\), 302\)/);
  assert.match(start, /buildAtlassianAuthorizeUrl/);
  assert.match(start, /Confluence連携は未設定です/);
  assert.doesNotMatch(`${urls}\n${confluence}\n${status}\n${start}\n${callback}`, /game-design-workspace\.naoki-takehara111\.chatgpt\.site/);
});

test("OAuth starts from a native new-tab link instead of an embedded-frame navigation", async () => {
  const client = await read("components/workspace-client.tsx");
  const urls = await read("lib/site-urls.ts");
  assert.match(client, /import \{ CONFLUENCE_CALLBACK_URL, SITE_ORIGIN \} from "@\/lib\/site-urls"/);
  assert.match(urls, /https:\/\/game-canvas\.app/);
  assert.match(client, /authStartUrl = `\$\{SITE_ORIGIN\}\/api\/workspaces\/\$\{encodeURIComponent\(slug\)\}\/confluence\/start`/);
  assert.match(client, /href=\{authStartUrl\}/);
  assert.match(client, /target="_blank"/);
  assert.match(client, /rel="noopener noreferrer"/);
  assert.match(client, /aria-label="Atlassian OAuth接続を新しいタブで開く"/);
  assert.match(client, /target="_top"/);
  assert.match(client, /認証リンクをコピー/);
  assert.match(client, /navigator\.clipboard\.writeText\(authStartUrl\)/);
  assert.match(client, /プレビューで新しいタブが開かない場合は、同じChatGPTアカウントでログインした通常ブラウザに認証リンクを貼り付けてください/);
  assert.match(client, /readOnly value=\{authStartUrl\}/);
  assert.match(client, /認証リンクをコピーできませんでした/);
  assert.doesNotMatch(client, /auth\.atlassian\.com\/authorize/);
  assert.doesNotMatch(client, /client_secret/);
  assert.doesNotMatch(client, /location\.href\s*=\s*d\.url/);
  assert.doesNotMatch(client, /fetch\(`\/api\/workspaces\/\$\{slug\}\/confluence\/start`/);
});

test("OAuth callback consumes state once and validates expiry, user, owner and cancellation", async () => {
  const [callback, validation] = await Promise.all([read("app/api/confluence/callback/route.ts"), read("lib/oauth-state.ts")]);
  assert.match(callback, /DELETE FROM oauth_states WHERE state=\?1 RETURNING/);
  assert.match(callback, /validateOAuthStateContext/);
  assert.match(validation, /Date\.parse\(record\.expires_at\)/);
  assert.match(validation, /record\.user_email !== currentAccountKey/);
  assert.match(validation, /membershipRole !== "owner"/);
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

test("invitations use hashed one-time URLs and explicit owner approval", async () => {
  const [route, client, schema] = await Promise.all([read("app/api/workspaces/[slug]/members/route.ts"), read("components/workspace-client.tsx"), read("db/schema.ts")]);
  assert.match(route, /authorizeWorkspace\([^\n]+\["owner"\]\)/);
  assert.match(route, /body\.role !== "editor" && body\.role !== "viewer"/);
  assert.match(route, /status='cancelled'/);
  assert.match(route, /hashInviteToken/);
  assert.match(route, /workspace_join_requests/);
  assert.match(route, /status='approved'/);
  assert.match(schema, /secureWorkspaceInvites/);
  assert.match(schema, /workspaceJoinRequests/);
  assert.match(client, /招待URLを発行/);
  assert.match(client, /確認コード/);
  assert.doesNotMatch(route, /sendMail|update_site_access/i);
});
