"use client";

import { Puzzle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ExtensionActionDialog } from "./extensions/extension-action-dialog";
import { ExtensionFormDialog } from "./extensions/extension-form-dialog";
import { ExtensionPanel } from "./extensions/extension-panel";
import { ExtensionSettingsDialog } from "./extensions/extension-settings-dialog";
import { useWorkspaceExtensions } from "./extensions/use-workspace-extensions";
import type { WorkspaceExtensionsProps } from "./extensions/types";
import "./workspace-extensions.css";

export function WorkspaceExtensions(props: WorkspaceExtensionsProps) {
  const manager = useWorkspaceExtensions(props);
  const { open, setOpen, loading, error, installed } = manager;
  const panel = <ExtensionPanel manager={manager} />;

  return (
    <>
      {props.presentation === "page" ? panel : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="workspace-extensions-trigger" aria-label="ワークスペースの拡張機能">
              <Puzzle size={15} /><span>拡張機能</span>
              {!loading && !error && installed.length > 0 && <span className="extension-trigger-count">{installed.length}</span>}
            </Button>
          </DialogTrigger>
          <DialogContent className="extension-manager-dialog">
            <DialogHeader>
              <DialogTitle>拡張機能</DialogTitle>
              <DialogDescription>必要なアプリを追加して、グループごとにまとめて使えます。</DialogDescription>
            </DialogHeader>
            {panel}
          </DialogContent>
        </Dialog>
      )}
      <ExtensionSettingsDialog manager={manager} />
      <ExtensionFormDialog manager={manager} />
      <ExtensionActionDialog manager={manager} />
    </>
  );
}
