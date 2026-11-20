import assert from "node:assert/strict";
import test from "node:test";
import {
  validateSceneCreation,
  validateWorkspaceCreation,
} from "../lib/creation-validation.ts";

test("workspace validation rejects missing names and invalid slugs", () => {
  assert.equal(
    validateWorkspaceCreation({}).error,
    "ワークスペース名を入力してください",
  );
  assert.match(
    validateWorkspaceCreation({ name: "企画", slug: "日本語 slug" }).error ??
      "",
    /スラッグ/,
  );
});

test("workspace validation creates safe unique automatic slugs", () => {
  const first = validateWorkspaceCreation({ name: "日本語の企画" });
  const second = validateWorkspaceCreation({ name: "日本語の企画" });
  if (!first.value || !second.value) {
    assert.fail("valid workspace input was rejected");
  }
  assert.match(first.value.slug, /^workspace-[a-z0-9-]{12}$/);
  assert.notEqual(first.value.slug, second.value.slug);
});

test("scene validation rejects missing titles and unsafe URLs", () => {
  assert.match(validateSceneCreation({}).error ?? "", /場面タイトル/);
  assert.match(
    validateSceneCreation({
      title: "導入",
      confluencePageUrl: "http://example.com",
    }).error ?? "",
    /https:\/\//,
  );
  assert.ok(
    "value" in
      validateSceneCreation({
        title: "導入",
        confluencePageUrl:
          "https://example.atlassian.net/wiki/spaces/GAME/pages/123",
      }),
  );
});
