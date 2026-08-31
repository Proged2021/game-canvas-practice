"use client";
import { useEffect, useId, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  normalizeMarkdownForRendering,
  remarkPlotlineBreaks,
  remarkPlotlineCallouts,
  safeMarkdownUrl,
} from "@/lib/markdown-plugins";

const SVG_TAGS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan",
  "defs", "marker", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "title", "desc", "style",
]);
const SVG_ATTRIBUTES = new Set([
  "id", "class", "viewBox", "width", "height", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry",
  "d", "points", "transform", "fill", "fill-opacity", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "stroke-dasharray", "stroke-opacity", "opacity", "font-size", "font-family", "font-weight", "text-anchor", "dominant-baseline",
  "marker-start", "marker-mid", "marker-end", "offset", "stop-color", "stop-opacity", "clip-path", "mask", "role", "aria-label", "style",
]);

function safeSvgCss(value: string) {
  return !/@import|javascript:|data:|expression\s*\(|url\((?!\s*#)/i.test(value);
}

export function sanitizeMermaidSvg(svg: string) {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (document.querySelector("parsererror") || document.documentElement.localName !== "svg") return "";
  const elements = [document.documentElement, ...document.documentElement.querySelectorAll("*")];
  for (const element of elements) {
    if (!SVG_TAGS.has(element.localName)) {
      element.remove();
      continue;
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name;
      const value = attribute.value;
      if (name.startsWith("on") || !SVG_ATTRIBUTES.has(name)) element.removeAttribute(name);
      else if (!safeSvgCss(value) || /https?:/i.test(value)) element.removeAttribute(name);
    }
    if (element.localName === "style" && !safeSvgCss(element.textContent ?? "")) element.remove();
  }
  const root = document.documentElement;
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", "Mermaid図");
  return new XMLSerializer().serializeToString(root);
}

function Mermaid({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, "");
  useEffect(() => {
    let active = true;
    import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: "neutral",
        securityLevel: "strict",
        maxTextSize: 50_000,
        flowchart: { htmlLabels: false },
      });
      try {
        const result = await mermaid.render(`mermaid-${id}`, source.slice(0, 50_000));
        const safeSvg = sanitizeMermaidSvg(result.svg);
        if (active && ref.current) {
          if (safeSvg) ref.current.innerHTML = safeSvg;
          else ref.current.textContent = "Mermaid図を安全に表示できません";
        }
      } catch {
        if (active && ref.current) ref.current.textContent = "Mermaid図を表示できません";
      }
    }).catch(() => {
      if (active && ref.current) ref.current.textContent = "Mermaid図を表示できません";
    });
    return () => { active = false; };
  }, [source, id]);
  return <div className="mermaid-block" role="img" aria-label="Mermaid図" ref={ref} />;
}

function SafeMarkdownLink({ node, ...props }: React.ComponentPropsWithoutRef<"a"> & { node?: unknown }) {
  void node;
  const external = /^(?:https?:|mailto:)/i.test(props.href ?? "");
  return external
    ? <a {...props} target="_blank" rel="noopener noreferrer nofollow" />
    : <a {...props} />;
}

function SafeMarkdownImage({ node, alt, ...props }: React.ComponentPropsWithoutRef<"img"> & { node?: unknown }) {
  void node;
  // Markdown images can use protected same-origin asset routes, which are not compatible with image optimization.
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} alt={alt ?? ""} loading="lazy" decoding="async" />;
}

export function MarkdownView({ markdown }: { markdown: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkPlotlineCallouts, remarkPlotlineBreaks]}
        rehypePlugins={[[rehypeKatex, { strict: "error", trust: false, throwOnError: false, maxSize: 20, maxExpand: 1000 }]]}
        remarkRehypeOptions={{ footnoteLabel: "脚注", footnoteBackLabel: "本文へ戻る" }}
        urlTransform={safeMarkdownUrl}
        components={{
          a: SafeMarkdownLink,
          img: SafeMarkdownImage,
          code: ({ className, children, ...props }) => className === "language-mermaid"
            ? <Mermaid source={String(children).replace(/\n$/, "")} />
            : <code className={className} {...props}>{children}</code>,
          input: (props) => <input {...props} readOnly tabIndex={-1} />,
        }}
      >
        {normalizeMarkdownForRendering(markdown)}
      </ReactMarkdown>
    </div>
  );
}
