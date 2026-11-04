"use client";

import { Image as ImageIcon, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WorkspaceViewModel } from './view-model';

export function ConfluenceImageImportPanel({ workspace }: { workspace: WorkspaceViewModel }) {
  const {
    slug,
    syncing,
    sourceLoading,
    manualUpload,
    imageImportOptions,
    imageImportOptionsLoading,
    imageImportOptionsError,
    imageImportConnection,
    setImageImportConnection,
    imageImportScope,
    setImageImportScope,
    imageImport,
    active,
    loadImageImportOptions,
    importConfluenceImages,
    stopConfluenceImageImport,
  } = workspace;
  if (!active) return null;
  return (
    <section className="confluence-image-import" aria-labelledby="confluence-image-import-title" aria-busy={imageImport.active || imageImportOptionsLoading}>
      <div>
        <h4 id="confluence-image-import-title">Confluenceから画像を一括取得</h4>
        <p>リンク済みの場面で欠けている画像を、本文内の元の位置へ追加します。本文と保存済みの画像は保持されます。</p>
      </div>
      {imageImportOptionsLoading ? (
        <p className="confluence-image-import-note" role="status"><Loader2 size={15} className="spin" />接続先と場面を読み込んでいます…</p>
      ) : imageImportOptionsError ? (
        <>
          <p className="form-error" role="alert">{imageImportOptionsError}</p>
          <Button type="button" variant="outline" onClick={() => void loadImageImportOptions()} disabled={imageImport.active}>
            <RefreshCw size={15} />取得先を再読み込み
          </Button>
        </>
      ) : imageImportOptions && (
        <>
          {imageImportOptions.connections.length ? (
            <div className="confluence-image-import-fields">
              <div>
                <label htmlFor="confluence-image-import-connection">Confluenceの接続先</label>
                <Select value={imageImportConnection} onValueChange={setImageImportConnection} disabled={imageImport.active || syncing || manualUpload.active}>
                  <SelectTrigger id="confluence-image-import-connection"><SelectValue placeholder="接続先を選ぶ" /></SelectTrigger>
                  <SelectContent>
                    {imageImportOptions.connections.map((connection) => (
                      <SelectItem key={connection.slug} value={connection.slug}>{connection.name}{connection.current ? "（このワークスペース）" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label htmlFor="confluence-image-import-scope">画像を追加する範囲</label>
                <Select value={imageImportScope} onValueChange={(value) => setImageImportScope(value === "current" ? "current" : "all")} disabled={imageImport.active || syncing || manualUpload.active}>
                  <SelectTrigger id="confluence-image-import-scope"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">ワークスペースの全場面（{imageImportOptions.scenes.length}場面）</SelectItem>
                    <SelectItem value="current" disabled={!imageImportOptions.scenes.some((scene) => scene.id === active.id)}>この場面</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <p className="confluence-image-import-note">利用できるConfluence接続がありません。このワークスペースを接続するか、接続済みワークスペースのオーナーのアカウントでお試しください。</p>
          )}
          {!imageImportOptions.scenes.length && <p className="confluence-image-import-note">先に場面へConfluenceページを設定してください。</p>}
          <div className="scene-confluence-actions">
            <Button
              type="button"
              onClick={() => void importConfluenceImages()}
              disabled={imageImport.active || syncing || manualUpload.active || sourceLoading || !imageImportConnection || !imageImportOptions.scenes.length || (imageImportScope === "current" && !imageImportOptions.scenes.some((scene) => scene.id === active.id))}
            >
              {imageImport.active ? <Loader2 size={15} className="spin" /> : <ImageIcon size={15} />}
              {imageImport.active ? "画像を取得中…" : "画像を一括取得"}
            </Button>
            {imageImport.active && (
              <Button type="button" variant="outline" onClick={stopConfluenceImageImport} disabled={imageImport.stopRequested}>
                {imageImport.stopRequested ? "この場面の完了後に停止" : "停止する"}
              </Button>
            )}
          </div>
          {manualUpload.active && <p className="confluence-image-import-note">画像の保存が終わると、一括取得を開始できます。</p>}
        </>
      )}
      {imageImport.message && (
        <div className="confluence-image-import-result" role="status" aria-live="polite">
          <p>{imageImport.message}</p>
          {imageImport.total > 0 && <progress max={imageImport.total} value={imageImport.completed} aria-label={`${imageImport.total}場面中${imageImport.completed}場面を処理`} />}
          <p>画像: 取得 {imageImport.saved}件・保存済み {imageImport.alreadySaved}件・取得失敗 {imageImport.failed}件・未配置 {imageImport.unmatched}件</p>
        </div>
      )}
      {imageImport.errors.length > 0 && (
        <details className="confluence-image-import-errors">
          <summary>確認が必要な内容（{imageImport.errors.length}件）</summary>
          <ul>{imageImport.errors.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
