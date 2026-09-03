export type LocalImageSlot = {
  slotKey: string;
  label: string;
  src?: string | null;
};

export type LocalMarkdownImage = {
  start: number;
  end: number;
  alt: string;
  source: string;
  syntax: "markdown" | "html";
};

function decodeOnce(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function normalizeLocalImageFilename(value: string) {
  const decoded = decodeOnce(value.trim()).replace(/[?#].*$/, "").replaceAll("\\", "/");
  const basename = decoded.split("/").filter(Boolean).at(-1) ?? "";
  return basename.normalize("NFKC").toLocaleLowerCase("en-US");
}

function sourceFilename(value: string) {
  try {
    const url = new URL(value, "https://game-canvas.local");
    return normalizeLocalImageFilename(url.pathname);
  } catch {
    return normalizeLocalImageFilename(value);
  }
}

function attribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match?.[1] ?? match?.[2] ?? "";
}

function replaceSrcAttribute(tag: string, value: string) {
  const pattern = /(\bsrc\s*=\s*)(?:"[^"]*"|'[^']*')/i;
  if (pattern.test(tag)) return tag.replace(pattern, `$1"${value}"`);
  return tag.replace(/\s*\/?>$/, (ending) => ` src="${value}"${ending}`);
}

function createSlotMatcher(slots: LocalImageSlot[], includeMissing = false) {
  const candidates = includeMissing ? slots : slots.filter((slot) => Boolean(slot.src));
  const used = new Set<string>();
  return (alt: string, source: string) => {
    const exact = source.trim();
    let match = candidates.find((slot) => !used.has(slot.slotKey) && Boolean(exact) && slot.src === exact);
    const altName = normalizeLocalImageFilename(alt);
    const sourceName = sourceFilename(source);
    if (!match && (altName || sourceName)) {
      match = candidates.find((slot) => {
        if (used.has(slot.slotKey)) return false;
        const label = normalizeLocalImageFilename(slot.label);
        return Boolean(label) && (label === altName || label === sourceName);
      });
    }
    if (match) used.add(match.slotKey);
    return match ?? null;
  };
}

function markdownDestination(inner: string) {
  const leading = inner.match(/^\s*/)?.[0] ?? "";
  const body = inner.slice(leading.length);
  if (body.startsWith("<")) {
    const end = body.indexOf(">");
    if (end >= 0) {
      const source = body.slice(1, end);
      return {
        source,
        replace: (value: string) => `${leading}<${value}>${body.slice(end + 1)}`,
      };
    }
  }
  const token = body.match(/^\S+/)?.[0] ?? "";
  return {
    source: token,
    replace: (value: string) => `${leading}${value}${body.slice(token.length)}`,
  };
}

/** Returns editable image tokens in document order without resolving or fetching them. */
export function extractLocalMarkdownImages(markdown: string): LocalMarkdownImage[] {
  const images: LocalMarkdownImage[] = [];
  for (const match of markdown.matchAll(/!\[([^\]]*)\]\(([\s\S]*?)\)/g)) {
    const whole = match[0];
    const start = match.index ?? 0;
    images.push({
      start,
      end: start + whole.length,
      alt: match[1] ?? "",
      source: markdownDestination(match[2] ?? "").source,
      syntax: "markdown",
    });
  }
  for (const match of markdown.matchAll(/<img\b[^>]*>/gi)) {
    const whole = match[0];
    const start = match.index ?? 0;
    images.push({
      start,
      end: start + whole.length,
      alt: attribute(whole, "alt") || attribute(whole, "title"),
      source: attribute(whole, "src"),
      syntax: "html",
    });
  }
  return images.sort((left, right) => left.start - right.start);
}

function safeMarkdownLabel(filename: string) {
  return filename.replace(/[\[\]\r\n]/g, " ").trim() || "画像";
}

function safeMarkdownDestination(filename: string) {
  return filename.replace(/[<>\r\n]/g, "").trim() || "image";
}

export function insertLocalMarkdownImage(markdown: string, position: number, filename: string) {
  const at = Math.max(0, Math.min(markdown.length, position));
  const token = `![${safeMarkdownLabel(filename)}](<${safeMarkdownDestination(filename)}>)`;
  const before = markdown.slice(0, at);
  const after = markdown.slice(at);
  const prefix = before && !before.endsWith("\n") ? "\n\n" : "";
  const suffix = after && !after.startsWith("\n") ? "\n\n" : "";
  const value = `${before}${prefix}${token}${suffix}${after}`;
  return { markdown: value, cursor: before.length + prefix.length + token.length };
}

export function removeLocalMarkdownImage(markdown: string, image: Pick<LocalMarkdownImage, "start" | "end">) {
  const start = Math.max(0, Math.min(markdown.length, image.start));
  const end = Math.max(start, Math.min(markdown.length, image.end));
  return `${markdown.slice(0, start)}${markdown.slice(end)}`.replace(/\n{3,}/g, "\n\n");
}

/** Associates each local image token with its current image-manager slot. */
export function linkLocalMarkdownImages(markdown: string, slots: LocalImageSlot[]) {
  const matchSlot = createSlotMatcher(slots, true);
  return extractLocalMarkdownImages(markdown).map((image) => ({
    ...image,
    slot: matchSlot(image.alt, image.source),
  }));
}

/** Replace empty or stale Markdown image destinations with the current protected asset URL. */
export function rewriteLocalMarkdownImageSources(markdown: string, slots: LocalImageSlot[]) {
  const matchSlot = createSlotMatcher(slots);
  return markdown.replace(/!\[([^\]]*)\]\(([\s\S]*?)\)/g, (whole, alt: string, inner: string) => {
    const destination = markdownDestination(inner);
    const slot = matchSlot(alt, destination.source);
    return slot?.src ? `![${alt}](${destination.replace(slot.src)})` : whole;
  });
}

/** Replace local HTML image destinations for legacy local-edit rows. */
export function rewriteLocalHtmlImageSources(html: string, slots: LocalImageSlot[]) {
  const matchSlot = createSlotMatcher(slots);
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const slot = matchSlot(attribute(tag, "alt"), attribute(tag, "src"));
    return slot?.src ? replaceSrcAttribute(tag, slot.src) : tag;
  });
}
