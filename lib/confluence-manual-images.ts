import { MAX_CONFLUENCE_IMAGE_BYTES, SAFE_IMAGE_MEDIA_TYPES, sanitizeConfluenceHtml, type ConfluenceImageReference } from "./confluence-safe.ts";

export const MAX_MANUAL_IMAGES_PER_SCENE = 30;
export const MAX_MANUAL_SCENE_BYTES = 50 * 1024 * 1024;
export const MAX_MANUAL_IMAGE_PIXELS = 40_000_000;
export const MAX_MANUAL_IMAGE_DIMENSION = 16_384;

export type ConfluenceImageSlot = {
  slotKey: string;
  label: string;
  normalizedFilename: string;
  occurrence: number;
};

function decodeOnce(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function normalizeManualFilename(value: string) {
  const decoded = decodeOnce(value.trim()).replaceAll("\\", "/");
  const basename = decoded.split("/").filter(Boolean).at(-1) ?? "";
  return basename.normalize("NFKC").toLocaleLowerCase("en-US");
}

function safeLabel(value: string, index: number) {
  const basename = decodeOnce(value).replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? "";
  return basename.replace(/[\u0000-\u001f\u007f<>"']/g, "").slice(0, 180) || `画像${index + 1}`;
}

async function stableSlotKey(pageId: string, filename: string, occurrence: number) {
  const input = new TextEncoder().encode(`${pageId}\u0000${filename}\u0000${occurrence}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildConfluenceImageSlots(pageId: string, references: ConfluenceImageReference[]) {
  const counts = new Map<string, number>();
  const slots: ConfluenceImageSlot[] = [];
  for (const [index, reference] of references.slice(0, MAX_MANUAL_IMAGES_PER_SCENE).entries()) {
    const normalizedFilename = normalizeManualFilename(reference.filename || reference.normalizedFilename || `image-${index + 1}`);
    const occurrence = (counts.get(normalizedFilename) ?? 0) + 1;
    counts.set(normalizedFilename, occurrence);
    slots.push({
      slotKey: await stableSlotKey(pageId, normalizedFilename, occurrence),
      label: safeLabel(reference.filename, index),
      normalizedFilename,
      occurrence,
    });
  }
  return slots;
}

function attribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match?.[1] ?? match?.[2] ?? "";
}

export function extractConfluenceImageSlots(html: string) {
  const slots: Array<{ slotKey: string; label: string }> = [];
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const slotKey = attribute(match[0], "data-confluence-slot");
    if (!/^[a-f0-9]{32}$/.test(slotKey)) continue;
    const label = attribute(match[0], "data-confluence-slot-label") || attribute(match[0], "alt") || "Confluence画像";
    slots.push({ slotKey, label: safeLabel(label, slots.length) });
  }
  return slots;
}

export function rewriteConfluenceSlotSources(html: string, proxyPrefix: string, assets: Map<string, string>) {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const slotKey = attribute(tag, "data-confluence-slot");
    const assetKey = assets.get(slotKey);
    if (!assetKey || !/^[a-f0-9]{32}$/.test(assetKey)) return tag;
    const source = `${proxyPrefix}/${assetKey}`;
    const withoutSource = tag
      .replace(/\s+src\s*=\s*(?:"[^"]*"|'[^']*')/i, "")
      .replace(/\bconfluence-image-unavailable\b/g, "")
      .replace(/\s{2,}/g, " ");
    return withoutSource.replace(/\s*\/?\s*>$/, (ending) => ` src="${source}"${ending.includes("/") ? " />" : ">"}`);
  });
}

export function renderConfluenceHtmlWithSlots(input: {
  html: string;
  baseUrl: string;
  slots: ConfluenceImageSlot[];
  proxyPrefix: string;
  manualAssets: Map<string, string>;
  automaticAssets?: Array<{ assetKey: string; normalizedFilename: string }>;
}) {
  let index = 0;
  const usedAutomatic = new Set<number>();
  let matched = 0;
  const html = sanitizeConfluenceHtml(input.html, input.baseUrl, (_source, attributes) => {
    const slot = input.slots[index++];
    if (!slot) return null;
    let assetKey = input.manualAssets.get(slot.slotKey) ?? "";
    if (!assetKey) {
      const automaticIndex = (input.automaticAssets ?? []).findIndex((asset, candidateIndex) =>
        !usedAutomatic.has(candidateIndex) && asset.normalizedFilename === slot.normalizedFilename);
      if (automaticIndex >= 0) {
        usedAutomatic.add(automaticIndex);
        assetKey = input.automaticAssets![automaticIndex].assetKey;
      }
    }
    if (assetKey) matched += 1;
    return {
      src: assetKey ? `${input.proxyPrefix}/${encodeURIComponent(assetKey)}` : null,
      attributes: {
        "data-confluence-slot": slot.slotKey,
        "data-confluence-slot-label": slot.label,
        alt: attributes.alt || slot.label,
        title: attributes.title || slot.label,
      },
    };
  });
  return { html, matchedImages: matched, missingImages: Math.max(0, input.slots.length - matched), imageReferences: input.slots.length };
}

function u16be(bytes: Uint8Array, offset: number) { return (bytes[offset] << 8) | bytes[offset + 1]; }
function u16le(bytes: Uint8Array, offset: number) { return bytes[offset] | (bytes[offset + 1] << 8); }
function u24le(bytes: Uint8Array, offset: number) { return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16); }
function u32be(bytes: Uint8Array, offset: number) { return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0; }

function dimensions(bytes: Uint8Array, mime: string): { width: number; height: number } | null {
  if (mime === "image/png" && bytes.length >= 24)
    return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
  if (mime === "image/gif" && bytes.length >= 10)
    return { width: u16le(bytes, 6), height: u16le(bytes, 8) };
  if (mime === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker))
        return { height: u16be(bytes, offset + 5), width: u16be(bytes, offset + 7) };
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const length = u16be(bytes, offset + 2);
      if (length < 2) return null;
      offset += length + 2;
    }
  }
  if (mime === "image/webp" && bytes.length >= 30) {
    const kind = String.fromCharCode(...bytes.slice(12, 16));
    if (kind === "VP8X") return { width: 1 + u24le(bytes, 24), height: 1 + u24le(bytes, 27) };
    if (kind === "VP8L" && bytes.length >= 25) {
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
    }
  }
  return null;
}

function detectedMime(bytes: Uint8Array) {
  if (bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
    && String.fromCharCode(...bytes.slice(12, 16)) === "IHDR") return "image/png";
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) return "image/jpeg";
  if (bytes.length >= 14) {
    const signature = String.fromCharCode(...bytes.slice(0, 6));
    if ((signature === "GIF87a" || signature === "GIF89a") && bytes.at(-1) === 0x3b) return "image/gif";
  }
  if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

const EXTENSIONS: Record<string, Set<string>> = {
  "image/png": new Set(["png"]),
  "image/jpeg": new Set(["jpg", "jpeg"]),
  "image/gif": new Set(["gif"]),
  "image/webp": new Set(["webp"]),
};

export async function validateManualImage(file: File) {
  if (!file.size) throw new Error("0バイトの画像は保存できません。");
  if (file.size > MAX_CONFLUENCE_IMAGE_BYTES) throw new Error("画像は1枚10MiB以下にしてください。");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectedMime(bytes);
  const declared = file.type.toLowerCase();
  const extension = normalizeManualFilename(file.name).split(".").at(-1) ?? "";
  if (!mime || !SAFE_IMAGE_MEDIA_TYPES.has(mime) || declared !== mime || !EXTENSIONS[mime]?.has(extension))
    throw new Error("PNG、JPEG、GIF、WebPの正しい画像ファイルだけ保存できます。");
  const edgeText = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array([
    ...bytes.slice(0, Math.min(4096, bytes.length)),
    ...bytes.slice(Math.max(0, bytes.length - 4096)),
  ])).toLowerCase();
  if (/<(?:html|script|svg)|<\?xml|application\/json/.test(edgeText))
    throw new Error("実行可能な内容を含む画像は保存できません。");
  const size = dimensions(bytes, mime);
  if (!size || size.width < 1 || size.height < 1 || size.width > MAX_MANUAL_IMAGE_DIMENSION
    || size.height > MAX_MANUAL_IMAGE_DIMENSION || size.width * size.height > MAX_MANUAL_IMAGE_PIXELS)
    throw new Error("画像の寸法を安全に確認できないか、上限を超えています。");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { bytes: bytes.buffer, mime, sha256, extension };
}
