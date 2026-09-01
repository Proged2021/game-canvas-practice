import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  normalizeMarkdownForRendering,
  remarkPlotlineBreaks,
  remarkPlotlineCallouts,
  safeMarkdownUrl,
} from "../lib/markdown-plugins.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");
const render = (markdown: string) => renderToStaticMarkup(React.createElement(ReactMarkdown, {
  remarkPlugins: [remarkGfm, remarkMath, remarkPlotlineCallouts, remarkPlotlineBreaks],
  rehypePlugins: [[rehypeKatex, { strict: "error", trust: false, throwOnError: false, maxSize: 20, maxExpand: 1000 }]],
  remarkRehypeOptions: { footnoteLabel: "脚注", footnoteBackLabel: "本文へ戻る" },
  urlTransform: safeMarkdownUrl,
}, normalizeMarkdownForRendering(markdown)));

test("通常Markdownの見出し・装飾・引用・ネストリスト・コード・区切り・リンク・画像を描画する", () => {
  const html = render("# 見出し\n\n**太字** *斜体*\n\n> 引用\n\n1. 番号\n   - 子項目\n\n`code`\n\n```js\nconst n = 1\n```\n\n---\n\n[リンク](https://example.com) ![画像](/image.png)");
  for (const token of ["<h1>", "<strong>", "<em>", "<blockquote>", "<ol>", "<ul>", "<code>", "<pre>", "<hr/>", "href=\"https://example.com\"", "src=\"/image.png\""]) assert.match(html, new RegExp(token));
});

test("GFMのテーブル・取消線・タスクリスト・自動リンクを描画する", () => {
  const html = render("|A|B|\n|-|-|\n|1|2|\n\n~~取消~~\n\n- [x] 完了\n- [ ] 未完了\n\nhttps://example.com/path");
  assert.match(html, /<table>/);
  assert.match(html, /<del>取消<\/del>/);
  assert.match(html, /class=\"contains-task-list\"/);
  assert.match(html, /type=\"checkbox\"/);
  assert.match(html, /href=\"https:\/\/example\.com\/path\"/);
});

test("単一改行・空行・連続改行・CRLF・日本語・リスト内改行を保持して表示する", () => {
  const html = render("一行目\r\n二行目\r\n\r\n次の段落\r\n\r\n\r\n- 項目一\r\n  続き\r\n- 項目二");
  assert.match(html, /一行目<br\/>\s*二行目/);
  assert.match(html, /<p>次の段落<\/p>/);
  assert.match(html, /項目一<br\/>\s*続き/);
  assert.equal(normalizeMarkdownForRendering("a\r\nb\rc"), "a\nb\nc");
});

test("脚注を日本語ラベルと本文への戻りリンク付きで描画する", () => {
  const html = render("本文[^note]\n\n[^note]: 脚注内容");
  assert.match(html, /data-footnote-ref/);
  assert.match(html, />脚注<\/h2>/);
  assert.match(html, /aria-label=\"本文へ戻る\"/);
  assert.match(html, /脚注内容/);
});

test("NOTE・TIP・IMPORTANT・WARNING・CAUTIONを日本語Calloutとして描画する", () => {
  const markdown = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"].map((kind) => `> [!${kind}]\n> 内容`).join("\n\n");
  const html = render(markdown);
  for (const [kind, label] of [["note", "メモ"], ["tip", "ヒント"], ["important", "重要"], ["warning", "警告"], ["caution", "注意"]]) {
    assert.match(html, new RegExp(`markdown-callout-${kind}`));
    assert.match(html, new RegExp(`aria-label=\\"${label}\\"`));
  }
});

test("インライン数式とブロック数式をKaTeXで安全に描画する", () => {
  const html = render("インライン $x^2$\n\n$$\n\\sum_{i=1}^n i\n$$");
  assert.match(html, /class=\"katex\"/);
  assert.match(html, /class=\"katex-display\"/);
  assert.match(html, /x\^2/);
});

test("Mermaidはstrict設定・文字数上限・SVG許可リストを通して描画する", async () => {
  const component = await read("components/markdown-view.tsx");
  assert.match(component, /className === "language-mermaid"/);
  assert.match(component, /securityLevel: "strict"/);
  assert.match(component, /maxTextSize: 50_000/);
  assert.match(component, /sanitizeMermaidSvg\(result\.svg\)/);
  assert.match(component, /name\.startsWith\("on"\)/);
  assert.match(component, /flowchart: \{ htmlLabels: false \}/);
});

test("raw HTML・script・event handler・javascript URLを実行可能な出力にしない", async () => {
  const html = render("<script>alert(1)</script><img src=x onerror=alert(2)> [危険](javascript:alert(3))");
  assert.doesNotMatch(html, /<script|<img/i);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /href=/i);
  assert.equal(safeMarkdownUrl("javascript:alert(1)"), "");
  assert.equal(safeMarkdownUrl("data:text/html,x"), "");
  assert.equal(safeMarkdownUrl("//lookalike.example/path"), "");
  const component = await read("components/markdown-view.tsx");
  assert.match(component, /rel="noopener noreferrer nofollow"/);
  assert.match(component, /external = \/\^\(\?:https\?:\|mailto:\)\/i/);
  assert.match(component, /urlTransform=\{safeMarkdownUrl\}/);
});

test("Markdown原文は保存APIで変換せず再読込時も同じ列から返す", async () => {
  const route = await read("app/api/workspaces/[slug]/scenes/route.ts");
  assert.match(route, /body\.markdown \?\? ""/);
  assert.match(route, /SELECT s\.id,s\.title,s\.markdown/);
  assert.doesNotMatch(route, /markdown[\s\S]{0,80}replace\(/);
  assert.doesNotMatch(route, /markdown[\s\S]{0,80}normalizeMarkdownForRendering/);
});

test("編集原文・閲覧切替・場面切替は同じ選択場面Markdownを即時参照する", async () => {
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /value=\{active\.markdown\}/);
  assert.match(client, /updateScene\(\{ markdown: e\.target\.value \}\)/);
  assert.match(client, /<MarkdownView markdown=\{active\.markdown\}/);
  assert.match(client, /setSelectedId\(s\.id\)/);
});

test("Confluence本文・既存画像・手動画像の別経路を変更しない", async () => {
  const [client, assets, confluence] = await Promise.all([
    read("components/workspace-client.tsx"), read("lib/confluence-assets.ts"), read("lib/confluence-safe.ts"),
  ]);
  assert.match(client, /confluence-html/);
  assert.match(client, /別の方法で画像を追加/);
  assert.match(assets, /stageManualSceneAssets/);
  assert.match(confluence, /sanitize/);
});

test("version31の30日削除復元・表示名とUndo\/Redoを維持する", async () => {
  const [client, recovery, profile] = await Promise.all([
    read("components/workspace-client.tsx"), read("lib/scene-recovery-policy.ts"), read("app/api/workspaces/[slug]/profile/route.ts"),
  ]);
  assert.match(client, /restoreScene/);
  assert.match(client, /performUndo/);
  assert.match(client, /performRedo/);
  assert.match(recovery, /SCENE_RECOVERY_DAYS = 30/);
  assert.match(profile, /workspace_id=\?2 AND account_key=\?3/);
});

test("runtimeVersion 35・UI表示・no-store markerを公開する", async () => {
  const [version, runtime, client] = await Promise.all([
    read("lib/runtime-version.ts"), read("app/api/runtime/route.ts"), read("components/workspace-client.tsx"),
  ]);
  assert.match(version, /"35"/);
  assert.match(runtime, /cache-control.*no-store/s);
  assert.match(client, /実行版:35/);
});
