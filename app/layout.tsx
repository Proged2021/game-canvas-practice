// 各ページに共通するHTMLの外枠と、サイト名などの基本情報を用意する。
import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";

export const metadata: Metadata = {
  title: "ゲーム企画書ワークスペース",
  description: "Confluenceのストーリーと場面メモを一つの画面で共同編集するワークスペース。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased">{children}</body>
    </html>
  );
}
