"use client";

import { ClipboardPaste, Image as ImageIcon, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkspaceViewModel } from './view-model';

export function ManualImagePanel({ workspace }: { workspace: WorkspaceViewModel }) {
  const {
    error,
    manualSlots,
    manualUpload,
    imageImport,
    manualDragActive,
    setManualDragActive,
    preferredPasteSlot,
    active,
    uploadManualImages,
    assignSelectedFiles,
    pasteFromClipboard,
    handleManualPaste,
    status,
  } = workspace;
  if (!active) return null;
  return (
    <section
      className={`manual-image-import${manualDragActive ? " is-dragging" : ""}`}
      aria-labelledby="manual-image-import-title"
      onPaste={handleManualPaste}
      onDragEnter={(event) => { event.preventDefault(); setManualDragActive(true); }}
      onDragOver={(event) => { event.preventDefault(); setManualDragActive(true); }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setManualDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setManualDragActive(false);
        assignSelectedFiles([...event.dataTransfer.files]);
      }}
      tabIndex={0}
    >
      <div className="manual-image-heading">
        <div>
          <h4 id="manual-image-import-title">別の方法で画像を追加</h4>
          <p>Confluence画像をまとめて選ぶか、この欄へドラッグ＆ドロップしてください。ファイル名が一致する場所へ自動で割り当てます。</p>
        </div>
        <Button asChild type="button" variant="outline" disabled={manualUpload.active || imageImport.active || !manualSlots.length}>
          <label htmlFor="manual-confluence-images">
            <Upload size={15} />画像をまとめて選ぶ
          </label>
        </Button>
        <input
          id="manual-confluence-images"
          className="visually-hidden"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          disabled={manualUpload.active || imageImport.active}
          onChange={(event) => {
            assignSelectedFiles([...(event.currentTarget.files ?? [])]);
            event.currentTarget.value = "";
          }}
        />
      </div>
      {manualUpload.message && (
        <p className={manualUpload.active || manualUpload.completed > 0 ? "sync-feedback" : "form-error"} role="status" aria-live="polite">
          {manualUpload.active && <Loader2 size={15} className="spin" />}
          {manualUpload.message}
        </p>
      )}
      {!manualSlots.length ? (
        <p className="manual-image-empty">本文を同期すると、欠損画像の追加場所がここに表示されます。</p>
      ) : (
        <div className="manual-image-slots">
          {manualSlots.map((slot) => (
            <article className="manual-image-slot" key={slot.slotKey}>
              <div className="manual-image-preview">
                {slot.previewSrc || slot.src
                  // Protected same-origin image routes and local blob previews cannot use the optimizer.
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={slot.previewSrc ?? slot.src ?? ""} alt="" />
                  : <ImageIcon size={22} aria-hidden="true" />}
              </div>
              <div className="manual-image-copy">
                <strong>{slot.label}</strong>
                <span className={`manual-image-status is-${slot.status}`}>
                  {slot.status === "saved" ? "保存済み" : slot.status === "uploading" ? "保存中" : slot.status === "error" ? "失敗" : "未設定"}
                </span>
                {slot.error && <small>{slot.error}</small>}
              </div>
              <div className="manual-image-actions">
                <Button asChild type="button" size="sm" variant="outline" disabled={manualUpload.active || imageImport.active}>
                  <label htmlFor={`manual-slot-${slot.slotKey}`}>
                    {slot.status === "saved" ? "選び直す" : "ファイルを選ぶ"}
                  </label>
                </Button>
                <input
                  id={`manual-slot-${slot.slotKey}`}
                  className="visually-hidden"
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  disabled={manualUpload.active || imageImport.active}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) void uploadManualImages([{ slot, file }]);
                    event.currentTarget.value = "";
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={manualUpload.active || imageImport.active}
                  onFocus={() => { preferredPasteSlot.current = slot.slotKey; }}
                  onClick={() => void pasteFromClipboard(slot)}
                  aria-label={`${slot.label}へクリップボード画像を貼り付け`}
                >
                  <ClipboardPaste size={14} />貼り付け
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="manual-image-note">PNG・JPEG・GIF・WebP、1枚10MiB以下。画像をコピーした後、この欄でCtrl+Vしても追加できます。</p>
    </section>
  );
}
