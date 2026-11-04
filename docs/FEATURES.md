# 機能別ファイル案内

画面の入り口と、機能の実装を分けています。各画面の入り口は部品を組み立て、機能ごとの表示・操作は下のフォルダーで管理します。

## お知らせ・ワークスペース一覧

| 編集したいもの | ファイル |
| --- | --- |
| お知らせの文面・日付 | `lib/dashboard/announcement.ts` |
| お知らせの見た目 | `components/dashboard/dashboard-announcement.tsx` |
| ダッシュボード全体の組み立て | `components/dashboard-client.tsx` |
| ワークスペースの作成・複製 | `components/dashboard/workspace-editor-dialog.tsx` / `use-workspace-editor.ts` |
| ワークスペースの削除 | `components/dashboard/workspace-delete-dialog.tsx` / `use-workspace-deletion.ts` |
| 検索・表示順 | `components/dashboard/workspace-filters.tsx` / `lib/dashboard/workspace-filters.ts` |
| 一覧のカード | `components/dashboard/workspace-list.tsx` |
| 一覧の取得・更新 | `components/dashboard/use-workspaces.ts` |

お知らせは `title` が見出し、`paragraphs` が本文です。配列の1項目が画面の1段落になります。`date` は `YYYY-MM-DD`、`dateLabel` は画面に表示する日付です。

## ワークスペースの編集画面

表示は `components/workspace/` の `*.tsx`、操作は同じフォルダーの機能別 `*.ts` にあります。

| 機能 | 表示 | 操作 |
| --- | --- | --- |
| 画面全体 | `workspace-screen.tsx` / `workspace-header.tsx` | `use-workspace-controller.ts` |
| 場面の追加・並び替え・削除・復元 | `scene-list.tsx` / `scene-create-dialog.tsx` / `scene-delete-dialog.tsx` | `scene-management.ts` |
| 場面メモの編集 | `scene-editor.tsx` | `use-workspace-controller.ts` / `lib/scene-draft-saver.ts` |
| 参加者・招待・表示名 | `workspace-invitations-dialog.tsx` / `workspace-profile-dialog.tsx` | `workspace-sharing.ts` |
| Confluenceの接続・同期 | `confluence-settings-dialog.tsx` / `confluence-connect-link.tsx` | `confluence-sync.ts` |
| ストーリー本文の編集・保存 | `story-pane.tsx` | `local-story-drafts.ts` |
| 本文の画像操作 | `story-pane.tsx` | `local-story-images.ts` |
| Confluence画像の一括取得 | `confluence-image-import-panel.tsx` | `confluence-image-import.ts` |
| 画像のアップロード・貼り付け | `manual-image-panel.tsx` | `manual-images.ts` |
| 競合時の比較・解決 | `scene-conflict-dialog.tsx` / `local-story-conflict-dialog.tsx` | `use-workspace-controller.ts` / `local-story-drafts.ts` |

`components/workspace-client.tsx` は画面の入り口です。
`use-workspace-state.ts` は画面内で共有する状態と一時参照を持ち、`types.ts` はデータ型、`view-model.ts` は表示部品が受け取る型です。
保存完了を待ってから場面を切り替える処理など、複数機能に関わる連携は `use-workspace-controller.ts` にまとめています。

## 拡張機能

`components/workspace-extensions.tsx` が入り口、実装は `components/extensions/` です。

| 編集したいもの | ファイル |
| --- | --- |
| 一覧・検索・グループ | `extension-panel.tsx` / `extension-list.tsx` |
| 拡張機能のカード・起動ボタン | `extension-card.tsx` |
| 自作拡張の登録・変更 | `extension-form-dialog.tsx` |
| 設定 | `extension-settings-dialog.tsx` |
| 停止・削除などの確認画面 | `extension-action-dialog.tsx` |
| データ取得・変更・AI STUDIOの起動手順 | `use-workspace-extensions.ts` |
| 型・表示用の補助処理 | `types.ts` / `display.ts` |

## 共通部品・サーバー・AI STUDIO

- 再利用するボタンやダイアログは `components/ui/`、共通スタイルは `app/globals.css` です。
- サーバーの入口は `app/api/`、データ操作・認証・検証は `lib/` にあります。画面側の表示条件だけで権限を判断せず、既存のサーバー側チェックを維持します。
- AI STUDIO本体は `lllm/`、起動許可・セッションの確認は `lib/lllm-browser-authorization.ts`、提供先の範囲は `lib/lllm-workspaces.ts` です。
- ブラウザー側だけで動くConfluence本文の変換は `lib/confluence-html-to-markdown.ts` です。

今回の整理はファイル構成の変更です。DB移行や本番公開を伴いません。確認用プレビューがソースのコピーを使っている場合は、編集後にコピーを同期してから表示を確認します。
