"use client";

import { SceneDraftSaver } from "@/lib/scene-draft-saver";
import { useMemo, useRef, useState } from "react";
import { createSceneHistory, SceneHistory } from "@/lib/scene-history";
import type { Scene, SceneConfluenceSource, ManualImageSlot, ConfluenceImageImportOptions, ConfluenceImageImportProgress, ConfluenceStatus, WorkspaceData, WorkspaceClientProps } from './types';

export function useWorkspaceState({ initialData, initialSceneId }: WorkspaceClientProps) {
  const [data, setData] = useState<WorkspaceData | null>(initialData),
    [selectedId, setSelectedId] = useState(initialSceneId ?? initialData.scenes[0]?.id ?? ""),
    [editMode, setEditMode] = useState(true);
  const editModeRequest = useRef(0);
  const [saveState, setSaveState] = useState<
    "saved" | "saving" | "dirty" | "conflict" | "error"
  >("saved"),
    [online, setOnline] = useState(true),
    [error, setError] = useState("");
  const [inviteRole, setInviteRole] = useState("editor"),
    [inviteSaving, setInviteSaving] = useState(false),
    [inviteError, setInviteError] = useState(""),
    [inviteUrl, setInviteUrl] = useState(""),
    [inviteCopyState, setInviteCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle"),
    [pageInput, setPageInput] = useState(
      initialData.scenes.find((scene) => scene.id === initialSceneId)?.confluence_page_url ?? initialData.scenes[0]?.confluence_page_url ?? "",
    ),
    [syncing, setSyncing] = useState(false);
  const [inviteActionId, setInviteActionId] = useState("");
  const [sceneSource, setSceneSource] = useState<SceneConfluenceSource | null>(null);
  const [sourceLoading, setSourceLoading] = useState(Boolean(initialData.scenes[0]));
  const [localStoryEditing, setLocalStoryEditing] = useState(false);
  const [localStoryDraft, setLocalStoryDraft] = useState("");
  const [localStoryDirty, setLocalStoryDirty] = useState(false);
  const [localStorySaveState, setLocalStorySaveState] = useState<"saved" | "saving" | "dirty" | "conflict" | "error">("saved");
  const [localStoryFeedback, setLocalStoryFeedback] = useState("");
  const [localStoryResetOpen, setLocalStoryResetOpen] = useState(false);
  const [localStoryResetting, setLocalStoryResetting] = useState(false);
  const [syncConfirmOpen, setSyncConfirmOpen] = useState(false);
  const localStoryEditorRef = useRef<HTMLTextAreaElement>(null);
  const localImageAddInputRef = useRef<HTMLInputElement>(null);
  const [activeEditorPane, setActiveEditorPane] = useState<"left" | "right">("right");
  const localStoryTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const localStoryDrafts = useRef(new Map<string, string>());
  const localStorySaved = useRef(new Map<string, string>());
  const localStoryRevisions = useRef(new Map<string, number>());
  const localStorySaveChains = useRef(new Map<string, Promise<void>>());
  const localStoryConflicts = useRef(new Set<string>());
  const [localConflict, setLocalConflict] = useState<{ sceneId: string; source: SceneConfluenceSource | null; slots: ManualImageSlot[] } | null>(null);
  const [localConflictLoading, setLocalConflictLoading] = useState(false);
  const localStoryComposing = useRef(false);
  const [localStoryHistories, setLocalStoryHistories] = useState(new Map<string, SceneHistory>());
  const [confluenceDialogOpen, setConfluenceDialogOpen] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{
    type: "progress" | "success" | "error";
    message: string;
  } | null>(null);
  const [manualSlots, setManualSlots] = useState<ManualImageSlot[]>([]);
  const [manualUpload, setManualUpload] = useState<{
    active: boolean;
    completed: number;
    total: number;
    message: string;
  }>({ active: false, completed: 0, total: 0, message: "" });
  const [imageImportOptions, setImageImportOptions] = useState<ConfluenceImageImportOptions | null>(null);
  const [imageImportOptionsLoading, setImageImportOptionsLoading] = useState(false);
  const [imageImportOptionsError, setImageImportOptionsError] = useState("");
  const [imageImportConnection, setImageImportConnection] = useState("");
  const [imageImportScope, setImageImportScope] = useState<"all" | "current">("all");
  const [imageImport, setImageImport] = useState<ConfluenceImageImportProgress>({
    active: false, stopRequested: false, completed: 0, total: 0,
    saved: 0, alreadySaved: 0, failed: 0, unmatched: 0, message: "", errors: [],
  });
  const imageImportInFlight = useRef(false);
  const imageImportStopRequested = useRef(false);
  const [manualDragActive, setManualDragActive] = useState(false);
  const preferredPasteSlot = useRef<string>("");
  const [confluenceStatus, setConfluenceStatus] = useState<ConfluenceStatus | null>(null);
  const [sceneDialogOpen, setSceneDialogOpen] = useState(false),
    [sceneTitle, setSceneTitle] = useState(""),
    [sceneConfluenceUrl, setSceneConfluenceUrl] = useState(""),
    [sceneCreating, setSceneCreating] = useState(false),
    [sceneError, setSceneError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Scene | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [reorderSaving, setReorderSaving] = useState(false);
  const [sceneQuery, setSceneQuery] = useState("");
  const [sceneLinkState, setSceneLinkState] = useState<"idle" | "copied" | "failed">("idle");
  const [sceneConflicts, setSceneConflicts] = useState(new Map<string, Scene | null>());
  const [conflictOpen, setConflictOpen] = useState(false);
  const [conflictCopyFeedback, setConflictCopyFeedback] = useState("");
  const [draggingSceneId, setDraggingSceneId] = useState("");
  const dragOriginalOrder = useRef<Scene[]>([]);
  const dragCurrentOrder = useRef<Scene[]>([]);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const [restoreSavingId, setRestoreSavingId] = useState("");
  const [displayNameOpen, setDisplayNameOpen] = useState(false);
  const [displayName, setDisplayName] = useState(initialData.currentUser.displayName ?? "");
  const [displayNameSaving, setDisplayNameSaving] = useState(false);
  const [displayNameError, setDisplayNameError] = useState("");
  const inviteUrlInputRef = useRef<HTMLInputElement>(null);
  const inviteCopyInFlight = useRef(false);
  const inviteCopyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimers = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const latestScenes = useRef(
    new Map(initialData.scenes.map((scene) => [scene.id, scene])),
  );
  const sceneMutationEpoch = useRef(0);
  const loadRequestSequence = useRef(0);
  const [sceneHistories, setSceneHistories] = useState(
    new Map<string, SceneHistory>(
      initialData.scenes.map((scene) => [
        scene.id,
        createSceneHistory({ title: scene.title, markdown: scene.markdown }),
      ]),
    ),
  );
  const sceneSaver = useRef<SceneDraftSaver<Scene> | null>(null);
  const sceneComposing = useRef(false);
  const sourceRequestSequence = useRef(0);
  const active = useMemo(
    () => data?.scenes.find((s) => s.id === selectedId) ?? data?.scenes[0],
    [data, selectedId],
  );
  const selectedSceneIdRef = useRef(active?.id ?? "");
  return {
    data,
    setData,
    selectedId,
    setSelectedId,
    editMode,
    setEditMode,
    editModeRequest,
    saveState,
    setSaveState,
    online,
    setOnline,
    error,
    setError,
    inviteRole,
    setInviteRole,
    inviteSaving,
    setInviteSaving,
    inviteError,
    setInviteError,
    inviteUrl,
    setInviteUrl,
    inviteCopyState,
    setInviteCopyState,
    pageInput,
    setPageInput,
    syncing,
    setSyncing,
    inviteActionId,
    setInviteActionId,
    sceneSource,
    setSceneSource,
    sourceLoading,
    setSourceLoading,
    localStoryEditing,
    setLocalStoryEditing,
    localStoryDraft,
    setLocalStoryDraft,
    localStoryDirty,
    setLocalStoryDirty,
    localStorySaveState,
    setLocalStorySaveState,
    localStoryFeedback,
    setLocalStoryFeedback,
    localStoryResetOpen,
    setLocalStoryResetOpen,
    localStoryResetting,
    setLocalStoryResetting,
    syncConfirmOpen,
    setSyncConfirmOpen,
    localStoryEditorRef,
    localImageAddInputRef,
    activeEditorPane,
    setActiveEditorPane,
    localStoryTimers,
    localStoryDrafts,
    localStorySaved,
    localStoryRevisions,
    localStorySaveChains,
    localStoryConflicts,
    localConflict,
    setLocalConflict,
    localConflictLoading,
    setLocalConflictLoading,
    localStoryComposing,
    localStoryHistories,
    setLocalStoryHistories,
    confluenceDialogOpen,
    setConfluenceDialogOpen,
    syncFeedback,
    setSyncFeedback,
    manualSlots,
    setManualSlots,
    manualUpload,
    setManualUpload,
    imageImportOptions,
    setImageImportOptions,
    imageImportOptionsLoading,
    setImageImportOptionsLoading,
    imageImportOptionsError,
    setImageImportOptionsError,
    imageImportConnection,
    setImageImportConnection,
    imageImportScope,
    setImageImportScope,
    imageImport,
    setImageImport,
    imageImportInFlight,
    imageImportStopRequested,
    manualDragActive,
    setManualDragActive,
    preferredPasteSlot,
    confluenceStatus,
    setConfluenceStatus,
    sceneDialogOpen,
    setSceneDialogOpen,
    sceneTitle,
    setSceneTitle,
    sceneConfluenceUrl,
    setSceneConfluenceUrl,
    sceneCreating,
    setSceneCreating,
    sceneError,
    setSceneError,
    deleteTarget,
    setDeleteTarget,
    deleteSaving,
    setDeleteSaving,
    reorderSaving,
    setReorderSaving,
    sceneQuery,
    setSceneQuery,
    sceneLinkState,
    setSceneLinkState,
    sceneConflicts,
    setSceneConflicts,
    conflictOpen,
    setConflictOpen,
    conflictCopyFeedback,
    setConflictCopyFeedback,
    draggingSceneId,
    setDraggingSceneId,
    dragOriginalOrder,
    dragCurrentOrder,
    deleteCancelRef,
    restoreSavingId,
    setRestoreSavingId,
    displayNameOpen,
    setDisplayNameOpen,
    displayName,
    setDisplayName,
    displayNameSaving,
    setDisplayNameSaving,
    displayNameError,
    setDisplayNameError,
    inviteUrlInputRef,
    inviteCopyInFlight,
    inviteCopyResetTimer,
    saveTimers,
    latestScenes,
    sceneMutationEpoch,
    loadRequestSequence,
    sceneHistories,
    setSceneHistories,
    sceneSaver,
    sceneComposing,
    sourceRequestSequence,
    active,
    selectedSceneIdRef,
  };
}
export type WorkspaceState = ReturnType<typeof useWorkspaceState>;
