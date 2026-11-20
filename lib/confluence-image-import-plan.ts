import { normalizeManualFilename } from "./confluence-manual-images.ts";
import { normalizeConfluenceFilename } from "./confluence-safe.ts";
import type { SnapshotImage } from "./confluence-snapshot.ts";

type ImportSlot = { slotKey: string; label: string };

function filename(value: string) {
  return normalizeManualFilename(normalizeConfluenceFilename(value));
}

function contentIdentity(asset: SnapshotImage) {
  return `${asset.sha256}:${asset.mime}:${asset.bytes.byteLength}`;
}

/** Plan placements without replacing saved slots or changing any input data. */
export function planConfluenceImageImport(input: {
  slots: ImportSlot[];
  savedSlots: Map<string, string>;
  assets: SnapshotImage[];
}) {
  const candidatesByName = new Map<string, SnapshotImage[]>();
  for (const asset of input.assets) {
    const names = new Set([
      asset.reference.normalizedFilename,
      asset.reference.filename,
      asset.filename,
    ].map(filename).filter(Boolean));
    for (const name of names) {
      const candidates = candidatesByName.get(name) ?? [];
      candidates.push(asset);
      candidatesByName.set(name, candidates);
    }
  }

  const assignments: Array<{ slotKey: string; assetKey: string }> = [];
  const selectedAssets = new Map<string, SnapshotImage>();
  let alreadySaved = 0;
  let unmatched = 0;
  for (const slot of input.slots) {
    if (input.savedSlots.has(slot.slotKey)) {
      alreadySaved += 1;
      continue;
    }
    const candidates = candidatesByName.get(filename(slot.label)) ?? [];
    const selected = candidates[0];
    if (!selected || candidates.some((candidate) => contentIdentity(candidate) !== contentIdentity(selected))) {
      unmatched += 1;
      continue;
    }
    assignments.push({ slotKey: slot.slotKey, assetKey: selected.assetKey });
    selectedAssets.set(selected.assetKey, selected);
  }

  return { assignments, assets: [...selectedAssets.values()], alreadySaved, unmatched };
}
