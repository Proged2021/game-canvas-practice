import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { hashInviteToken, randomToken } from "../lib/secure-invites.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("invite tokens carry 256 bits and only their SHA-256 hash is persisted", async () => {
  const first = randomToken();
  const second = randomToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  const digest = await hashInviteToken(first);
  assert.match(digest, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(digest, first);
  const schema = await read("db/schema.ts");
  assert.match(schema, /tokenHash: text\("token_hash"\)/);
  assert.doesNotMatch(schema, /token: text\("token"\)/);
});

test("opening a forwarded link creates only a pending request", async () => {
  const route = await read("app/api/join-requests/route.ts");
  assert.match(route, /INSERT INTO workspace_join_requests/);
  assert.match(route, /'pending'/);
  assert.doesNotMatch(route, /INSERT(?: OR IGNORE)? INTO account_memberships/);
  assert.match(route, /requireApiUser\(\)/);
});

test("owner approval alone creates membership and consumes the invite", async () => {
  const route = await read("app/api/workspaces/[slug]/members/route.ts");
  assert.match(route, /authorizeWorkspace\([^\n]+\["owner"\]\)/);
  assert.match(route, /INSERT OR IGNORE INTO account_memberships/);
  assert.match(route, /r\.status='pending'/);
  assert.match(route, /i\.status='active'/);
  assert.match(route, /SET status='used',used_at=CURRENT_TIMESTAMP/);
});

test("expired, cancelled and used invitations cannot be redeemed", async () => {
  const [join, members] = await Promise.all([
    read("app/api/join-requests/route.ts"), read("app/api/workspaces/[slug]/members/route.ts"),
  ]);
  assert.match(join, /i\.status='active'/);
  assert.match(join, /Date\.parse\(invite\.expires_at\) <= Date\.now\(\)/);
  assert.match(join, /status='expired'/);
  assert.match(members, /status='cancelled'/);
  assert.match(members, /i\.expires_at>CURRENT_TIMESTAMP/);
});

test("join requests and decisions are isolated to the selected workspace", async () => {
  const [auth, route] = await Promise.all([read("lib/auth.ts"), read("app/api/workspaces/[slug]/members/route.ts")]);
  assert.match(auth, /getMembership\(slug, auth\.user\.accountKey\)/);
  assert.match(route, /r\.workspace_id=\?2/);
  assert.match(route, /workspace_id=\?2/);
});

test("owner and applicant see only a random confirmation code, not identity claims", async () => {
  const [client, database, join] = await Promise.all([
    read("components/workspace-client.tsx"), read("lib/db.ts"), read("app/api/join-requests/route.ts"),
  ]);
  assert.match(client, /確認コード/);
  assert.match(database, /confirmation_code/);
  assert.doesNotMatch(client, /メールアドレス|member\.email|invitation\.email/);
  assert.doesNotMatch(join, /email|fullName|userId/);
});

test("workspace creation makes the authenticated opaque principal the owner atomically", async () => {
  const route = await read("app/api/workspaces/route.ts");
  assert.match(route, /db\(\)\.batch/);
  assert.match(route, /account_memberships/);
  assert.match(route, /auth\.user\.accountKey/);
  assert.doesNotMatch(route, /auth\.user\.email/);
});

test("all workspace content APIs use the common membership boundary", async () => {
  const paths = [
    "app/api/workspaces/[slug]/route.ts",
    "app/api/workspaces/[slug]/scenes/route.ts",
    "app/api/workspaces/[slug]/members/route.ts",
    "app/api/workspaces/[slug]/confluence/status/route.ts",
    "app/api/workspaces/[slug]/confluence/start/route.ts",
    "app/api/workspaces/[slug]/confluence/sync/route.ts",
  ];
  for (const source of await Promise.all(paths.map(read))) assert.match(source, /authorizeWorkspace/);
});
