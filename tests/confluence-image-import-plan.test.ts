import test from "node:test";
import assert from "node:assert/strict";
import { planConfluenceImageImport } from "../lib/confluence-image-import-plan.ts";
import type { SnapshotImage } from "../lib/confluence-snapshot.ts";

function image(assetKey: string, filename: string, sha256 = assetKey): SnapshotImage {
  return {
    assetKey,
    filename,
    mime: "image/png",
    bytes: new Uint8Array([137, 80, 78, 71]).buffer,
    sha256,
    reference: { filename, normalizedFilename: filename, sourceUrls: [] },
  };
}

test("saved placements remain unchanged and only missing slots are planned", () => {
  const savedSlots = new Map([["saved", "existing-asset"], ["not-in-page", "other-asset"]]);
  const replacement = image("new-saved", "saved.png");
  const fresh = image("new-missing", "missing.png");
  const result = planConfluenceImageImport({
    slots: [
      { slotKey: "saved", label: "saved.png" },
      { slotKey: "missing", label: "missing.png" },
      { slotKey: "failed", label: "failed.png" },
    ],
    savedSlots,
    assets: [replacement, fresh],
  });
  assert.deepEqual(result, {
    assignments: [{ slotKey: "missing", assetKey: fresh.assetKey }],
    assets: [fresh],
    alreadySaved: 1,
    unmatched: 1,
  });
  assert.equal(savedSlots.get("saved"), "existing-asset");
});

test("matching decodes filenames, strips paths/query, and normalizes width and case", () => {
  const asset = image("asset", "canonical-title.png");
  asset.reference.filename = "folders\\%E7%94%BB%E5%83%8F%2520%EF%BC%A1.PNG?version=2";
  asset.reference.normalizedFilename = "";
  const result = planConfluenceImageImport({
    slots: [{ slotKey: "slot", label: "別フォルダー/画像 a.png#preview" }],
    savedSlots: new Map(),
    assets: [asset],
  });
  assert.deepEqual(result.assignments, [{ slotKey: "slot", assetKey: "asset" }]);
  assert.equal(result.unmatched, 0);
});

test("reference normalized name and actual attachment filename are both usable aliases", () => {
  const asset = image("asset", "attachment.png");
  asset.reference.filename = "view-name.png";
  asset.reference.normalizedFilename = "normalized-name.png";
  const result = planConfluenceImageImport({
    slots: ["attachment.png", "view-name.png", "normalized-name.png"].map((label) => ({ slotKey: label, label })),
    savedSlots: new Map(),
    assets: [asset],
  });
  assert.deepEqual(result.assignments.map((item) => item.assetKey), ["asset", "asset", "asset"]);
  assert.deepEqual(result.assets, [asset]);
});

test("the same stored image can fill repeated occurrences without duplicating bytes", () => {
  const asset = image("one-asset", "repeated.png");
  const result = planConfluenceImageImport({
    slots: [
      { slotKey: "first", label: "repeated.png" },
      { slotKey: "second", label: "repeated.png" },
    ],
    savedSlots: new Map(),
    assets: [asset, asset],
  });
  assert.deepEqual(result.assignments, [
    { slotKey: "first", assetKey: "one-asset" },
    { slotKey: "second", assetKey: "one-asset" },
  ]);
  assert.deepEqual(result.assets, [asset]);
});

test("ambiguous names with different content remain unmatched", () => {
  const first = image("first", "image.png", "first-content");
  const second = image("second", "IMAGE.PNG", "second-content");
  const savedSlots = new Map([["saved", "existing"]]);
  const result = planConfluenceImageImport({
    slots: [
      { slotKey: "missing", label: "image.png" },
      { slotKey: "saved", label: "image.png" },
    ],
    savedSlots,
    assets: [first, second],
  });
  assert.deepEqual(result, { assignments: [], assets: [], alreadySaved: 1, unmatched: 1 });
});

test("same-name snapshots with identical content reuse the first candidate deterministically", () => {
  const first = image("first", "image.png", "same-content");
  const second = image("second", "image.png", "same-content");
  const result = planConfluenceImageImport({
    slots: [{ slotKey: "slot", label: "image.png" }],
    savedSlots: new Map(),
    assets: [first, second],
  });
  assert.deepEqual(result.assignments, [{ slotKey: "slot", assetKey: "first" }]);
  assert.deepEqual(result.assets, [first]);
});

test("identical hash with inconsistent binary metadata is not silently assigned", () => {
  const first = image("first", "image.png", "same-hash");
  const second = image("second", "image.png", "same-hash");
  second.bytes = new Uint8Array([1]).buffer;
  const result = planConfluenceImageImport({
    slots: [{ slotKey: "slot", label: "image.png" }],
    savedSlots: new Map(),
    assets: [first, second],
  });
  assert.equal(result.unmatched, 1);
  assert.deepEqual(result.assignments, []);
});

test("empty names never match and unused downloads are not returned for persistence", () => {
  const unnamed = image("unnamed", "");
  const unused = image("unused", "unused.png");
  const result = planConfluenceImageImport({
    slots: [{ slotKey: "slot", label: "" }],
    savedSlots: new Map(),
    assets: [unnamed, unused],
  });
  assert.deepEqual(result, { assignments: [], assets: [], alreadySaved: 0, unmatched: 1 });
});

test("planning is deterministic and leaves frozen inputs, order, maps, and bytes intact", () => {
  const first = image("first", "first.png");
  const second = image("second", "second.png");
  const slots = [{ slotKey: "b", label: "second.png" }, { slotKey: "a", label: "first.png" }];
  const savedSlots = new Map<string, string>();
  const assets = [first, second];
  const before = structuredClone({ slots, savedSlots, assets });
  for (const asset of assets) { Object.freeze(asset.reference); Object.freeze(asset); }
  for (const slot of slots) Object.freeze(slot);
  Object.freeze(assets);
  Object.freeze(slots);
  const input = { slots, savedSlots, assets };
  const firstPlan = planConfluenceImageImport(input);
  const secondPlan = planConfluenceImageImport(input);
  assert.deepEqual(firstPlan, secondPlan);
  assert.deepEqual(firstPlan.assets.map((asset) => asset.assetKey), ["second", "first"]);
  assert.deepEqual({ slots, savedSlots, assets }, before);
});
