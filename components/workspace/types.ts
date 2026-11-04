export type Scene = {
  id: string;
  title: string;
  confluence_page_url?: string | null;
  markdown: string;
  position: number;
  revision: number;
  updated_by: string;
  updated_at?: string;
};

export type ConfluenceConnection = {
  connected?: number;
  last_error?: string | null;
  attachment_scope_granted?: number;
} | null;

export type SceneConfluenceSource = {
  scene_id: string;
  page_id: string;
  page_url: string;
  page_title: string;
  page_version: number;
  synced_html: string;
  last_synced_at: string;
  last_checked_at?: string;
  last_error?: string | null;
  local_html?: string | null;
  local_markdown?: string | null;
  local_revision?: number;
  local_updated_at?: string | null;
  display_html?: string;
  has_local_edit?: boolean;
};

export type ManualImageSlot = {
  slotKey: string;
  label: string;
  status: "saved" | "missing" | "error" | "uploading";
  src?: string | null;
  previewSrc?: string;
  error?: string;
};

export type ManualImageUploadResult = {
  error?: string;
  code?: string;
  runtimeVersion?: string;
  uploadId?: string;
  chunkBytes?: number;
  chunkCount?: number;
  alreadySaved?: boolean;
  saved?: number;
  slots?: ManualImageSlot[];
  source?: {
    synced_html?: string;
    local_html?: string | null;
    local_markdown?: string | null;
    display_html?: string;
  };
};

export type ConfluenceImageImportOptions = {
  connections: Array<{ slug: string; name: string; current: boolean }>;
  scenes: Array<{ id: string; title: string; pageUrl: string }>;
};

export type ConfluenceImageImportProgress = {
  active: boolean;
  stopRequested: boolean;
  completed: number;
  total: number;
  saved: number;
  alreadySaved: number;
  failed: number;
  unmatched: number;
  message: string;
  errors: string[];
};

export type DeletedScene = {
  id: string;
  title: string;
  position: number;
  deleted_at: string;
  delete_expires_at: string;
};

export type ConfluenceStatus = {
  state: "unconfigured" | "available" | "connected" | "reauth_required";
  configured: boolean;
  connected: boolean;
  callbackUrl: string;
  requiredSecrets: string[];
  tokenEncryptionConfigured: boolean;
};

export type WorkspaceData = {
  workspace: {
    name: string;
    slug: string;
    role: "owner" | "editor" | "viewer";
  };
  currentUser: { label: string; displayName: string | null };
  scenes: Scene[];
  deletedScenes: DeletedScene[];
  members: Array<{ role: string; display_name: string | null; is_current: number; created_at: string }>;
  invitations: Array<{ id: string; role: "editor" | "viewer"; status: string; expires_at: string; created_at: string }>;
  joinRequests: Array<{ id: string; confirmation_code: string; role: "editor" | "viewer"; status: string; created_at: string; expires_at: string }>;
  confluence: ConfluenceConnection;
};

export type WorkspaceClientProps = { slug: string; initialData: WorkspaceData; initialSceneId?: string };
