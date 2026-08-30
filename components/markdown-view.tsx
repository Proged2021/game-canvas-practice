"use client";
import { useEffect, useId, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
function Mermaid({ source }: { source: string }) { const ref = useRef<HTMLDivElement>(null), id = useId().replace(/:/g, ""); useEffect(() => { let active = true; import("mermaid").then(async ({ default: m }) => { m.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict" }); try { const r = await m.render(`mermaid-${id}`, source); if (active && ref.current) ref.current.innerHTML = r.svg; } catch { if (active && ref.current) ref.current.textContent = "Mermaid図を表示できません"; } }); return () => { active = false; }; }, [source, id]); return <div className="mermaid-block" ref={ref} />; }
export function MarkdownView({ markdown }: { markdown: string }) { return <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{ a: p => <a {...p} target="_blank" rel="noopener noreferrer" />, code: ({ className, children, ...p }) => className === "language-mermaid" ? <Mermaid source={String(children).replace(/\n$/, "")} /> : <code className={className} {...p}>{children}</code>, input: p => <input {...p} readOnly /> }}>{markdown}</ReactMarkdown></div>; }
