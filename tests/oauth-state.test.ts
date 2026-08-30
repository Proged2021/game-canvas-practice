import assert from "node:assert/strict";
import test from "node:test";
import { validateOAuthStateContext } from "../lib/oauth-state.ts";

const now = Date.parse("2026-08-30T18:00:00.000Z");
const record = {
  workspace_id: "workspace-1",
  user_email: "opaque-account-key",
  expires_at: "2026-08-30T18:05:00.000Z",
};
const workspace = { slug: "test-1" };

test("accepts a fresh OAuth state bound to the owner and workspace", () => {
  assert.equal(validateOAuthStateContext(record, workspace, "opaque-account-key", "owner", now), "ok");
});

test("rejects tampered or replayed OAuth state records", () => {
  assert.equal(validateOAuthStateContext(null, workspace, "opaque-account-key", "owner", now), "state-invalid");
  assert.equal(validateOAuthStateContext(record, null, "opaque-account-key", "owner", now), "state-invalid");
});

test("rejects expired OAuth states", () => {
  assert.equal(validateOAuthStateContext({ ...record, expires_at: "2026-08-30T17:59:59.000Z" }, workspace, "opaque-account-key", "owner", now), "state-expired");
});

test("rejects a different authenticated user", () => {
  assert.equal(validateOAuthStateContext(record, workspace, "other-account-key", "owner", now), "owner-mismatch");
});

test("rejects non-owner roles", () => {
  assert.equal(validateOAuthStateContext(record, workspace, "opaque-account-key", "editor", now), "owner-mismatch");
});
