"use client";

import { CheckCircle2, ChevronDown, CircleHelp, FileText, Link2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import "./workspace-guide.css";

export function WorkspaceGuide({ editable }: { editable: boolean }) {
  const steps = [
    {
      title: "場面を選ぶ",
      body: editable
        ? "場面一覧から開きます。新しく始めるときは「場面を追加」。検索ではタイトルやメモから探せます。"
        : "場面一覧から開きます。検索ではタイトルやメモから、読みたい場面を探せます。",
      icon: Search,
    },
    {
      title: editable ? "ストーリーを見ながらメモする" : "ストーリーとメモを見比べる",
      body: editable
        ? "「ストーリー本文」が参考資料、「場面メモ」が企画を書き込む場所です。上部を「編集」に切り替えて入力します。"
        : "「ストーリー本文」で参考資料を、「場面メモ」でその場面の企画や気づきを確認できます。",
      icon: FileText,
    },
    ...(editable ? [
      {
        title: "参考ページや画像をつなぐ",
        body: "「参考ページを追加」でConfluenceのページを指定します。「本文を編集」から本文や画像を整えられます。変更はgame-canvas内に保存されます。",
        icon: Link2,
      },
      {
        title: "「保存済み」を確認する",
        body: "入力内容は自動保存されます。上部の表示を確認し、「閲覧」に切り替えると整形された本文とメモを読めます。",
        icon: CheckCircle2,
      },
    ] : [
      {
        title: "同じ場面をチームに伝える",
        body: "開いているページのURLをコピーすると、同じ場面を案内できます。内容を読めるのは、このワークスペースのメンバーだけです。",
        icon: Link2,
      },
    ]),
  ];

  return <Dialog>
    <DialogTrigger asChild>
      <Button type="button" variant="outline" size="sm" className="workspace-guide-trigger" aria-label="ワークスペースの使い方" title="使い方">
        <CircleHelp size={15} aria-hidden="true" /><span>使い方</span>
      </Button>
    </DialogTrigger>
    <DialogContent className="workspace-guide-dialog" showCloseButton={false}>
      <DialogClose asChild>
        <Button type="button" variant="ghost" size="icon-sm" className="workspace-guide-close" aria-label="使い方を閉じる"><X size={17} aria-hidden="true" /></Button>
      </DialogClose>
      <DialogHeader>
        <p className="workspace-guide-kicker">はじめて使う方へ</p>
        <DialogTitle>場面ごとに、企画を整理する</DialogTitle>
        <DialogDescription>参考になるストーリーと、その場面のメモを一緒に見られます。</DialogDescription>
      </DialogHeader>
      <ol className="workspace-guide-steps" role="list" aria-label="ワークスペースの基本操作">
        {steps.map((step, index) => <li key={step.title}>
          <span className="workspace-guide-number" aria-hidden="true">{index + 1}</span>
          <div><h3><step.icon size={16} aria-hidden="true" />{step.title}</h3><p>{step.body}</p></div>
        </li>)}
      </ol>
      {editable ? <>
        <details className="workspace-guide-more">
          <summary>保存できないときは<ChevronDown size={15} aria-hidden="true" /></summary>
          <div>
            <p><strong>保存エラー：</strong>画面を閉じずに接続を確認し、「保存を再試行」を押してください。</p>
            <p><strong>競合あり：</strong>「競合を確認」で手元の編集と共有版を比べ、使う内容を選びます。先に手元の編集をコピーすることもできます。</p>
          </div>
        </details>
        <details className="workspace-guide-more">
          <summary>覚えておくと便利な操作<ChevronDown size={15} aria-hidden="true" /></summary>
          <div>
            <p><kbd>Ctrl</kbd> + <kbd>S</kbd> ／ <kbd>⌘</kbd> + <kbd>S</kbd> で保存できます。</p>
            <p>場面の横の並べ替えアイコンをドラッグすると順番を変えられます。アイコンを選択して <kbd>↑</kbd> <kbd>↓</kbd> でも操作できます。</p>
            <p>「戻る」「進める」は、直前に操作した本文やメモに使えます。</p>
          </div>
        </details>
      </> : <p className="workspace-guide-role-note">閲覧者として参加しています。内容の変更が必要な場合は、ワークスペースのオーナーに編集権限を依頼してください。</p>}
      <div className="workspace-guide-footer"><DialogClose asChild><Button type="button">閉じて使う</Button></DialogClose></div>
    </DialogContent>
  </Dialog>;
}
