"use client";

import { useState } from "react";
import { ChevronDown, CircleHelp } from "lucide-react";

export function DashboardIntroduction({ hasWorkspaces, initiallyExpanded }: { hasWorkspaces: boolean; initiallyExpanded: boolean }) {
  const [introOpen, setIntroOpen] = useState(initiallyExpanded);

  return <section className="mb-6 grid gap-3" aria-label="ワークスペースのはじめ方">
    <p className="text-sm text-[#77746c]">{hasWorkspaces
      ? "参加済みの方は、一覧のワークスペースを開いて始められます。"
      : "新しく作る場合は、名前を決めるだけで始められます。招待された方は、参加が承認されると一覧に表示されます。"}</p>
    <details className="group rounded-xl border border-[#deddd7] bg-[#fafaf7]" open={introOpen}
      onToggle={(event) => setIntroOpen(event.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b44d2e] [&::-webkit-details-marker]:hidden">
        <CircleHelp size={16} className="text-[#a9492e]" aria-hidden="true" />初めての方へ<span className="text-xs font-normal text-[#77746c]">3つのステップ</span>
        <ChevronDown size={16} className="ml-auto text-[#898477] transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
      </summary>
      <div className="grid gap-4 px-4 pb-4">
        <ol className="grid gap-4 sm:grid-cols-3" role="list" aria-label="企画を始める3つのステップ">
          <li className="flex items-start gap-2"><span className="grid size-6 shrink-0 place-items-center rounded-lg bg-[#f3e4da] text-xs font-semibold text-[#a84a2e]" aria-hidden="true">1</span><div><h2 className="text-sm font-semibold">ワークスペースを作る</h2><p className="mt-1 text-xs leading-relaxed text-[#77746c]">企画ごとの作業場所です。「ワークスペースを作成」から名前を入力します。</p></div></li>
          <li className="flex items-start gap-2"><span className="grid size-6 shrink-0 place-items-center rounded-lg bg-[#f3e4da] text-xs font-semibold text-[#a84a2e]" aria-hidden="true">2</span><div><h2 className="text-sm font-semibold">場面を分ける</h2><p className="mt-1 text-xs leading-relaxed text-[#77746c]">物語の進行に合わせて「場面を追加」。タイトルを付けて整理します。</p></div></li>
          <li className="flex items-start gap-2"><span className="grid size-6 shrink-0 place-items-center rounded-lg bg-[#f3e4da] text-xs font-semibold text-[#a84a2e]" aria-hidden="true">3</span><div><h2 className="text-sm font-semibold">気づきをメモする</h2><p className="mt-1 text-xs leading-relaxed text-[#77746c]">場面メモに企画を書き込みます。参考ページの本文と並べて見られます。</p></div></li>
        </ol>
        <p className="border-t border-[#e7e4dc] pt-3 text-xs leading-relaxed text-[#77746c]">便利な機能は、ワークスペースを開いて「拡張機能」から追加できます。</p>
      </div>
    </details>
  </section>;
}
