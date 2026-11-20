type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
};

const CALLOUT_LABELS = {
  NOTE: "メモ",
  TIP: "ヒント",
  IMPORTANT: "重要",
  WARNING: "警告",
  CAUTION: "注意",
} as const;

export type CalloutKind = keyof typeof CALLOUT_LABELS;

function visitChildren(node: MdastNode, visitor: (node: MdastNode) => void) {
  visitor(node);
  for (const child of node.children ?? []) visitChildren(child, visitor);
}

/** CommonMark soft breaks are promoted to explicit break nodes without changing source text. */
export function remarkPlotlineBreaks() {
  return (tree: MdastNode) => {
    const splitText = (node: MdastNode) => {
      if (!node.children) return;
      const next: MdastNode[] = [];
      for (const child of node.children) {
        if (child.type !== "text" || !child.value?.includes("\n")) {
          next.push(child);
          continue;
        }
        const parts = child.value.split("\n");
        parts.forEach((part, index) => {
          if (part) next.push({ ...child, value: part });
          if (index < parts.length - 1) next.push({ type: "break" });
        });
      }
      node.children = next;
    };
    visitChildren(tree, splitText);
  };
}

/** GitHub-style alerts: `> [!NOTE]` through `> [!CAUTION]`. */
export function remarkPlotlineCallouts() {
  return (tree: MdastNode) => {
    visitChildren(tree, (node) => {
      if (node.type !== "blockquote") return;
      const firstParagraph = node.children?.[0];
      const firstText = firstParagraph?.type === "paragraph" ? firstParagraph.children?.[0] : undefined;
      if (firstText?.type !== "text" || !firstText.value) return;
      const match = firstText.value.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\n|\s+|$)/i);
      if (!match) return;
      const kind = match[1].toUpperCase() as CalloutKind;
      const remainder = firstText.value.slice(match[0].length);
      if (remainder) firstText.value = remainder;
      else firstParagraph!.children!.shift();
      if (firstParagraph?.children?.length === 0) node.children!.shift();
      node.data = {
        ...node.data,
        hName: "aside",
        hProperties: {
          className: [`markdown-callout`, `markdown-callout-${kind.toLowerCase()}`],
          role: "note",
          "data-callout-type": kind,
          "aria-label": CALLOUT_LABELS[kind],
        },
      };
      node.children!.unshift({
        type: "paragraph",
        data: { hProperties: { className: ["markdown-callout-title"] } },
        children: [{ type: "strong", children: [{ type: "text", value: CALLOUT_LABELS[kind] }] }],
      });
    });
  };
}

export function normalizeMarkdownForRendering(markdown: string) {
  return markdown.replace(/\r\n?/g, "\n");
}

export function safeMarkdownUrl(url: string) {
  const value = url.trim();
  if (value.startsWith("//")) return "";
  if (/^(?:#|\/|\.\/|\.\.\/|\?)/.test(value)) return value;
  try {
    const parsed = new URL(value);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? value : "";
  } catch {
    return "";
  }
}
