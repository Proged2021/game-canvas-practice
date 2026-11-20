export function confluenceHtmlToMarkdown(html: string) {
  if (typeof DOMParser === "undefined") return "";
  const document = new DOMParser().parseFromString(html, "text/html");
  const render = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return "";
    const children = () => [...node.childNodes].map(render).join("");
    const tag = node.tagName.toLowerCase();
    if (tag === "br") return "\n";
    if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${children().trim()}\n\n`;
    if (tag === "p" || tag === "div" || tag === "section" || tag === "article") return `${children().trimEnd()}\n\n`;
    if (tag === "strong" || tag === "b") return `**${children()}**`;
    if (tag === "em" || tag === "i") return `*${children()}*`;
    if (tag === "del" || tag === "s") return `~~${children()}~~`;
    if (tag === "code" && node.parentElement?.tagName.toLowerCase() !== "pre") return `\`${children()}\``;
    if (tag === "pre") return `\n\`\`\`\n${node.textContent ?? ""}\n\`\`\`\n\n`;
    if (tag === "blockquote") return `${children().trim().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
    if (tag === "a") return `[${children() || node.getAttribute("href") || "リンク"}](${node.getAttribute("href") ?? ""})`;
    if (tag === "img") return `![${node.getAttribute("alt") ?? "画像"}](${node.getAttribute("src") ?? ""})`;
    if (tag === "hr") return "\n---\n\n";
    if (tag === "ul" || tag === "ol") return [...node.children].map((item, index) => {
      const prefix = tag === "ol" ? `${index + 1}. ` : "- ";
      return `${prefix}${render(item).trim().replace(/\n/g, "\n  ")}`;
    }).join("\n") + "\n\n";
    if (tag === "li") return children();
    return children();
  };
  return [...document.body.childNodes].map(render).join("").replace(/\n{3,}/g, "\n\n").trimEnd();
}
