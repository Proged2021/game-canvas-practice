import sanitizeHtml from "sanitize-html";

export const MAX_LOCAL_CONFLUENCE_HTML_BYTES = 1024 * 1024;

function safeLink(value: string) {
  if (!value) return "";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value, "https://game-canvas.local");
    if (["http:", "https:", "mailto:"].includes(url.protocol)) return url.toString();
  } catch { /* rejected below */ }
  return "";
}

function safeAssetSource(value: string, workspaceId: string, sceneId: string) {
  try {
    const url = new URL(value, "https://game-canvas.local");
    const expected = `/api/workspaces/${encodeURIComponent(workspaceId)}/scenes/${encodeURIComponent(sceneId)}/confluence/assets/`;
    if (!url.pathname.startsWith(expected)) return "";
    const assetKey = url.pathname.slice(expected.length);
    if (!/^[a-f0-9]{32}$/.test(assetKey) || url.search || url.hash) return "";
    return `${expected}${assetKey}`;
  } catch { return ""; }
}

export function sanitizeLocalConfluenceHtml(input: string, workspaceId: string, sceneId: string) {
  if (new TextEncoder().encode(input).byteLength > MAX_LOCAL_CONFLUENCE_HTML_BYTES)
    throw new Error("LOCAL_CONFLUENCE_HTML_TOO_LARGE");
  return sanitizeHtml(input, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img", "figure", "figcaption", "details", "summary", "time", "mark", "thead", "tbody", "tfoot",
    ]),
    allowedAttributes: {
      "*": ["class", "title", "data-layout", "data-local-id"],
      a: ["href", "name", "target", "rel", "class", "title"],
      img: ["src", "alt", "title", "width", "height", "class", "loading", "data-confluence-slot", "data-confluence-slot-label"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan", "scope"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    disallowedTagsMode: "discard",
    transformTags: {
      a: (_tag, attrs) => ({
        tagName: "a",
        attribs: { ...attrs, href: safeLink(attrs.href ?? ""), target: "_blank", rel: "noopener noreferrer" },
      }),
      img: (_tag, attrs) => {
        const src = safeAssetSource(attrs.src ?? "", workspaceId, sceneId);
        return {
          tagName: "img",
          attribs: {
            ...attrs,
            src,
            alt: attrs.alt || (src ? "" : "画像を表示できません"),
            title: attrs.title || (src ? "" : "画像を表示できません"),
            class: `${attrs.class ?? ""}${src ? "" : " confluence-image-unavailable"}`.trim(),
            loading: "lazy",
          },
        };
      },
    },
  });
}
