import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  parseChatGPTUserHeaders,
} from "../lib/chatgpt-identity.ts";
import {
  authorizationEmail,
  INITIAL_ALLOWED_ACCOUNT_USER_ID,
  INITIAL_ALLOWED_USER_EMAIL,
  isInitialAllowedUser,
} from "../lib/access-policy.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("requires the authenticated email header and optionally captures the stable user id", () => {
  assert.equal(parseChatGPTUserHeaders(new Headers()), null);
  assert.equal(
    parseChatGPTUserHeaders(new Headers({
      "oai-authenticated-user-full-name": "Forged%20Name",
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    })),
    null,
  );

  const user = parseChatGPTUserHeaders(new Headers({
    "oai-authenticated-user-email": " Owner@Example.Test ",
    "oai-authenticated-user-full-name": "Display%20Only",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  }));
  assert.equal(user?.email, "owner@example.test");
  assert.equal(user?.displayName, "Display Only");
  assert.equal(user?.userId, null);

  const identified = parseChatGPTUserHeaders(new Headers({
    "oai-authenticated-user-email": "masked-owner@example.test",
    "oai-authenticated-user-id": ` ${INITIAL_ALLOWED_ACCOUNT_USER_ID.toUpperCase()} `,
  }));
  assert.equal(identified?.userId, INITIAL_ALLOWED_ACCOUNT_USER_ID);
});

test("initial application access is limited to the configured owner email", () => {
  assert.equal(INITIAL_ALLOWED_USER_EMAIL, "naoki.takehara111@gmail.com");
  assert.equal(isInitialAllowedUser(" NAOKI.TAKEHARA111@GMAIL.COM "), true);
  assert.equal(
    isInitialAllowedUser("masked-owner@example.test", INITIAL_ALLOWED_ACCOUNT_USER_ID),
    true,
  );
  assert.equal(
    authorizationEmail("masked-owner@example.test", INITIAL_ALLOWED_ACCOUNT_USER_ID),
    INITIAL_ALLOWED_USER_EMAIL,
  );
  assert.equal(isInitialAllowedUser("visitor@example.test"), false);
  assert.equal(
    isInitialAllowedUser("visitor@example.test", "different-authenticated-user"),
    false,
  );
});

test("builds only dispatch-owned, same-origin sign-in and sign-out paths", () => {
  assert.equal(chatGPTSignInPath("/w/test?tab=1"), "/signin-with-chatgpt?return_to=%2Fw%2Ftest%3Ftab%3D1");
  assert.equal(chatGPTSignOutPath("/"), "/signout-with-chatgpt?return_to=%2F");
  assert.equal(chatGPTSignInPath("https://attacker.example/"), "/signin-with-chatgpt?return_to=%2F");
});

test("anonymous root renders only the login landing and starts SIWC as a top-level navigation", async () => {
  const [page, landing] = await Promise.all([
    read("app/page.tsx"),
    read("components/login-landing.tsx"),
  ]);
  assert.match(page, /await getChatGPTUser\(\)/);
  assert.match(page, /if \(!user\)/);
  assert.match(page, /<LoginLanding/);
  assert.match(landing, /href=\{signInPath\}/);
  assert.match(landing, /target="_top"/);
  assert.match(landing, /ChatGPTでログイン/);
  assert.doesNotMatch(landing, /workspace\.slug|scenes|confluence_connections/);
});

test("authenticated but unapproved users receive a data-free access denied screen", async () => {
  const [page, landing, access] = await Promise.all([
    read("app/page.tsx"),
    read("components/login-landing.tsx"),
    read("lib/application-access.ts"),
  ]);
  assert.match(page, /await authorizeApplicationUser\(user\)/);
  assert.match(page, /<AccessDeniedLanding/);
  assert.match(landing, /このアプリを利用する権限がありません/);
  assert.match(access, /FROM members/);
  assert.match(access, /FROM workspace_invitations/);
  assert.match(access, /status = 'pending'/);
  assert.doesNotMatch(landing, /workspace\.slug|scenes|confluence_connections/);
});

test("all workspace APIs reject missing identity before returning records", async () => {
  const apiRoutes = [
    "app/api/workspaces/route.ts",
    "app/api/workspaces/[slug]/route.ts",
    "app/api/workspaces/[slug]/scenes/route.ts",
    "app/api/workspaces/[slug]/members/route.ts",
    "app/api/workspaces/[slug]/confluence/status/route.ts",
    "app/api/workspaces/[slug]/confluence/start/route.ts",
    "app/api/workspaces/[slug]/confluence/sync/route.ts",
  ];
  const sources = await Promise.all(apiRoutes.map(read));
  for (const source of sources) assert.match(source, /requireApiUser|authorizeWorkspace/);

  const auth = await read("lib/auth.ts");
  assert.match(auth, /status: 401/);
  assert.match(auth, /status: 403/);
  assert.match(auth, /await authorizeApplicationUser\(user\)/);
  assert.match(auth, /getMembership\(slug, auth\.user\.email\)/);
});

test("workspace pages and list queries cannot expose uninvited records", async () => {
  const [page, db, route] = await Promise.all([
    read("app/w/[slug]/page.tsx"),
    read("lib/db.ts"),
    read("app/api/workspaces/[slug]/route.ts"),
  ]);
  assert.match(page, /requireChatGPTUser/);
  assert.match(page, /await authorizeApplicationUser\(identity\)/);
  assert.match(page, /if \(!membership\) notFound\(\)/);
  assert.match(db, /JOIN members m ON m\.workspace_id = w\.id/);
  assert.match(db, /WHERE lower\(m\.email\) = lower\(\?1\)/);
  assert.match(route, /authorizeWorkspace\(slug\)/);
});

test("OAuth callback consumes state once and hides workspace paths from an unauthenticated or non-owner callback", async () => {
  const callback = await read("app/api/confluence/callback/route.ts");
  assert.match(callback, /DELETE FROM oauth_states WHERE state=\?1 RETURNING/);
  assert.match(callback, /await getChatGPTUser\(\)/);
  assert.match(callback, /await authorizeApplicationUser\(identity\)/);
  assert.match(callback, /if \(!user \|\| !membership \|\| membership\.role !== "owner"\) return safeRootRedirect\("auth-required"\)/);
  assert.match(callback, /validateOAuthStateContext/);
  assert.doesNotMatch(callback, /client_secret[^\n]*Response/);
});
