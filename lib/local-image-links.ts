export type LocalImageSlot = {
  slotKey: string;
  label: string;
  src?: string | null;
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

function createSlotMatcher(slots: LocalImageSlot[]) {
  const candidates = slots.filter((slot) => Boolean(slot.src));
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
