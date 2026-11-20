/** Public product information only. Never add workspace or member data here. */
export const PUBLIC_SITE_ORIGIN = "https://game-canvas.app";
// Public ownership proof for the user-approved Google Search Console account.
// Google requires this tag to remain published after verification.
export const PUBLIC_GOOGLE_SITE_VERIFICATION = "FZ3IE8RkINwuwytL58WSxjBBxIwnTKnVwzX7tdchjZk";
export const PUBLIC_SITE_TITLE = "ゲーム企画書ワークスペース | game-canvas.app";
export const PUBLIC_SITE_DESCRIPTION =
  "ストーリーと場面メモを場面ごとに整理し、チームで共同編集するゲーム企画書アプリ。MarkdownとConfluenceに対応し、ワークスペースの内容は招待されたメンバーだけが利用できます。";

export function robotsResponse() {
  return new Response(
    [
      "User-agent: *",
      "Allow: /",
      "Disallow: /w/",
      "Disallow: /apps/",
      "Disallow: /api/",
      "Disallow: /lllm-assets/",
      "Disallow: /signin-with-chatgpt",
      "Disallow: /signout-with-chatgpt",
      `Sitemap: ${PUBLIC_SITE_ORIGIN}/sitemap.xml`,
      "",
    ].join("\n"),
    { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" } },
  );
}

export function sitemapResponse() {
  // The homepage is the only public document. Do not enumerate workspaces.
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${PUBLIC_SITE_ORIGIN}/</loc></url></urlset>\n`,
    { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" } },
  );
}
