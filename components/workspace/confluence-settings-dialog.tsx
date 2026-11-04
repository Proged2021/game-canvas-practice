"use client";

import { AlertCircle, Check, ClipboardPaste, Image as ImageIcon, Link2, Loader2, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CONFLUENCE_CALLBACK_URL } from "@/lib/site-urls";
import { ConfluenceConnectLink } from './confluence-connect-link';
import { CONFLUENCE_STATUS_LABELS } from './confluence-status';
import type { WorkspaceViewModel } from './view-model';

import { ConfluenceImageImportPanel } from './confluence-image-import-panel';
import { ManualImagePanel } from './manual-image-panel';

export function ConfluenceSettingsDialog({ workspace }: { workspace: WorkspaceViewModel }) {
  const {
    slug,
    data,
    pageInput,
    setPageInput,
    syncing,
    sceneSource,
    confluenceDialogOpen,
    setConfluenceDialogOpen,
    syncFeedback,
    imageImport,
    imageImportInFlight,
    confluenceStatus,
    active,
    requestSync,
    refreshManualImageSlots,
    unlinkConfluenceSource,
  } = workspace;
  if (!active) return null;
  return (
    <Dialog
      open={confluenceDialogOpen}
      onOpenChange={(open) => {
        if (!syncing && !imageImportInFlight.current) {
          setConfluenceDialogOpen(open);
          if (open && active) void refreshManualImageSlots(active.id);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Link2 size={14} />
          {sceneSource ? "参考ページの設定" : "参考ページを追加"}
        </Button>
      </DialogTrigger>
      <DialogContent className="confluence-dialog">
        <DialogHeader>
          <DialogTitle>
            「{active.title || "無題"}」の参考ページ
          </DialogTitle>
          <DialogDescription>
            Confluenceのページを、この場面のストーリー本文として表示します。
          </DialogDescription>
        </DialogHeader>
        <div className="connection-state" role="status">
          <strong>
            {confluenceStatus
              ? CONFLUENCE_STATUS_LABELS[confluenceStatus.state]
              : "設定を確認中"}
          </strong>
        </div>
        {!data.confluence?.connected ? (
          data.workspace.role === "owner" ? (
            <>
              <p>{confluenceStatus?.configured ? "最初にConfluenceへ接続してください。接続後、使いたいページのURLを指定します。" : "Confluenceへの接続準備がまだ済んでいません。サイト管理者へ設定を依頼してください。場面メモはそのまま利用できます。"}</p>
              <ConfluenceConnectLink
                slug={slug}
                sceneId={active.id}
                configured={confluenceStatus?.configured}
              />
              {!confluenceStatus?.configured && (
                <details className="oauth-public-info"><summary>管理者向けの設定情報</summary>
                  <strong>必要なSecret名</strong>
                  <code>ATLASSIAN_CLIENT_ID</code>
                  <code>ATLASSIAN_CLIENT_SECRET</code>
                  <strong>Callback URL</strong>
                  <code>{CONFLUENCE_CALLBACK_URL}</code>
                </details>
              )}
            </>
          ) : (
            <p className="form-error">
              オーナーがAtlassian接続を完了すると、この場面へページを追加できます。
            </p>
          )
        ) : (
          <>
            {data.workspace.role === "owner" && (
              <div className="scene-reauthentication">
                <p className={confluenceStatus?.state === "reauth_required" ? "form-error" : undefined}>
                  {confluenceStatus?.state === "reauth_required"
                    ? "画像を表示するには、Atlassianの追加権限を許可して再接続してください。"
                    : "権限を更新する場合は、Atlassianへ再接続できます。"}
                </p>
                <ConfluenceConnectLink
                  slug={slug}
                  sceneId={active.id}
                  configured={confluenceStatus?.configured}
                />
              </div>
            )}
            {confluenceStatus?.state === "reauth_required" && (
              data.workspace.role !== "owner" && <div className="scene-reauthentication">
                <p className="form-error">
                  画像権限の再承認が必要です。ワークスペースのオーナーへ連絡してください。
                </p>
              </div>
            )}
            <label htmlFor="scene-confluence-page">
              参考にするConfluenceページのURL
            </label>
            <Input
              id="scene-confluence-page"
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
              placeholder="https://…atlassian.net/wiki/…/pages/…"
            />
            <div className="scene-confluence-actions">
              <Button
                onClick={requestSync}
                disabled={syncing || imageImport.active || (!pageInput && !sceneSource?.page_id)}
              >
                {syncing ? <Loader2 className="spin" /> : <RefreshCw />}
                {syncing ? "同期中…" : "同期する"}
              </Button>
              {sceneSource && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={unlinkConfluenceSource}
                  disabled={syncing || imageImport.active}
                >
                  関連付けを解除
                </Button>
              )}
            </div>
            {syncFeedback && (
              <p
                className={
                  syncFeedback.type === "error"
                    ? "form-error"
                    : "sync-feedback"
                }
                role={syncFeedback.type === "error" ? "alert" : "status"}
                aria-live="polite"
              >
                {syncFeedback.type === "success" && <Check size={16} />}
                {syncFeedback.type === "progress" && (
                  <Loader2 size={16} className="spin" />
                )}
                {syncFeedback.type === "error" && <AlertCircle size={16} />}
                {syncFeedback.message}
              </p>
            )}
            {sceneSource?.last_synced_at && (
              <p className="sync-meta">
                最終同期: {new Date(sceneSource.last_synced_at).toLocaleString("ja-JP")}
              </p>
            )}
          </>
        )}
        <ConfluenceImageImportPanel workspace={workspace} />
        {sceneSource && (
          <ManualImagePanel workspace={workspace} />
        )}
      </DialogContent>
    </Dialog>
  );
}
