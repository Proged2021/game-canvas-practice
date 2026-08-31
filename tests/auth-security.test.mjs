import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chatGPTSignInPath, parseChatGPTUserHeaders } from "../lib/chatgpt-identity.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("SIWC requires an authenticated identity and uses safe return paths", () => {
  assert.equal(parseChatGPTUserHeaders(new Headers()), null);
  const user = parseChatGPTUserHeaders(new Headers({
    "oai-authenticated-user-email": " Person@Example.Test ",
    "oai-authenticated-user-id": " Stable-Id ",
  }));
  assert.equal(user?.email, "person@example.test");
  assert.equal(user?.userId, "stable-id");
  assert.equal(chatGPTSignInPath("https://attacker.example"), "/signin-with-chatgpt?return_to=%2F");
});

test("authenticated users reach onboarding instead of ACCESS RESTRICTED", async () => {
  const [page, dashboard] = await Promise.all([read("app/page.tsx"), read("components/dashboard-client.tsx")]);
  assert.match(page, /if \(!user\)[\s\S]*LoginLanding/);
  assert.match(page, /principalForUser\(user\)/);
  assert.match(page, /listWorkspaces\(principal\.accountKey\)/);
  assert.doesNotMatch(page, /AccessDeniedLanding|authorizeApplicationUser/);
  assert.match(dashboard, /新しいワークスペースを作成/);
  assert.match(dashboard, /招待リンクから参加/);
});

test("account keys use server-secret HMAC with user id first and never leave APIs", async () => {
  const [principal, database, workspaceClient] = await Promise.all([
    read("lib/account-principal.ts"), read("lib/db.ts"), read("components/workspace-client.tsx"),
  ]);
  assert.match(principal, /env\.TOKEN_ENCRYPTION_KEY/);
  assert.match(principal, /user\.userId\?\.trim\(\)/);
  assert.match(principal, /name: "HMAC", hash: "SHA-256"/);
  assert.match(database, /account_memberships/);
  assert.match(database, /m\.account_key = \?1/);
  assert.doesNotMatch(workspaceClient, /member\.email|inviteEmail|type="email"/);
});

test("legacy owner migration is exact, one-time, atomic and scrubs raw identity columns", async () => {
  const principal = await read("lib/account-principal.ts");
  assert.match(principal, /normalizeEmail\(user\.email\) !== LEGACY_OWNER_EMAIL/);
  assert.match(principal, /owner_identity_migrations/);
  assert.match(principal, /await database\.batch\(\[/);
  assert.match(principal, /INSERT OR IGNORE INTO account_memberships/);
  assert.match(principal, /DELETE FROM workspace_invitations/);
  assert.match(principal, /DELETE FROM members/);
  assert.match(principal, /DELETE FROM oauth_states/);
  assert.match(principal, /UPDATE scenes SET updated_by=\?1/);
  assert.doesNotMatch(principal, /console\./);
});

test("all protected workspace paths share account-key membership authorization", async () => {
  const [auth, page, callback, database] = await Promise.all([
    read("lib/auth.ts"), read("app/w/[slug]/page.tsx"), read("app/api/confluence/callback/route.ts"), read("lib/db.ts"),
  ]);
  assert.match(auth, /status: 401/);
  assert.match(auth, /status: 403/);
  assert.match(auth, /getMembership\(slug, auth\.user\.accountKey\)/);
  assert.match(page, /getMembership\(slug, user\.accountKey\)/);
  assert.match(callback, /getMembership\(workspace\.slug, user\.accountKey\)/);
  assert.match(database, /WHERE w\.slug = \?1 AND m\.account_key = \?2/);
});

test("OAuth state is single-use and bound to the same opaque account key and owner role", async () => {
  const [callback, state] = await Promise.all([read("app/api/confluence/callback/route.ts"), read("lib/oauth-state.ts")]);
  assert.match(callback, /DELETE FROM oauth_states WHERE state=\?1 RETURNING/);
  assert.match(callback, /user\?\.accountKey/);
  assert.match(state, /record\.user_email !== currentAccountKey/);
  assert.match(state, /membershipRole !== "owner"/);
  assert.match(await read("lib/runtime-version.ts"), /"29"/);
});
