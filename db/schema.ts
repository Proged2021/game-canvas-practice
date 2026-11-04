import { sql } from "drizzle-orm";
import {
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  ownerEmail: text("owner_email").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const members = sqliteTable(
  "members",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: ["owner", "editor", "viewer"] }).notNull(),
    invitedBy: text("invited_by").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.email] }),
    index("members_email_idx").on(table.email),
  ],
);

export const scenes = sqliteTable(
  "scenes",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    confluencePageUrl: text("confluence_page_url"),
    markdown: text("markdown").notNull().default(""),
    position: integer("position").notNull().default(0),
    revision: integer("revision").notNull().default(1),
    updatedBy: text("updated_by").notNull(),
    deletedAt: text("deleted_at"),
    deleteExpiresAt: text("delete_expires_at"),
    deletedByAccountKey: text("deleted_by_account_key"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("scenes_workspace_position_idx").on(
      table.workspaceId,
      table.position,
    ),
  ],
);

export const confluenceConnections = sqliteTable("confluence_connections", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  cloudId: text("cloud_id"),
  cloudUrl: text("cloud_url"),
  accessTokenCiphertext: text("access_token_ciphertext"),
  refreshTokenCiphertext: text("refresh_token_ciphertext"),
  tokenExpiresAt: text("token_expires_at"),
  pageId: text("page_id"),
  pageUrl: text("page_url"),
  pageTitle: text("page_title"),
  pageVersion: integer("page_version"),
  syncedHtml: text("synced_html"),
  lastSyncedAt: text("last_synced_at"),
  lastCheckedAt: text("last_checked_at"),
  lastError: text("last_error"),
  attachmentScopeGranted: integer("attachment_scope_granted").notNull().default(0),
  updatedBy: text("updated_by"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const confluenceAttachments = sqliteTable(
  "confluence_attachments",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    pageId: text("page_id").notNull(),
    attachmentId: text("attachment_id").notNull(),
    filename: text("filename").notNull(),
    mediaType: text("media_type").notNull(),
    fileSize: integer("file_size").notNull(),
    downloadPath: text("download_path").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.pageId, table.attachmentId] }),
    index("confluence_attachments_page_idx").on(table.workspaceId, table.pageId),
  ],
);

export const sceneConfluenceSources = sqliteTable(
  "scene_confluence_sources",
  {
    sceneId: text("scene_id")
      .primaryKey()
      .references(() => scenes.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    pageId: text("page_id").notNull(),
    pageUrl: text("page_url").notNull(),
    pageTitle: text("page_title").notNull(),
    pageVersion: integer("page_version").notNull(),
    syncedHtml: text("synced_html").notNull(),
    lastSyncedAt: text("last_synced_at").notNull(),
    lastCheckedAt: text("last_checked_at"),
    lastError: text("last_error"),
    assetGeneration: text("asset_generation"),
    manualGeneration: text("manual_generation"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("scene_confluence_sources_workspace_idx").on(table.workspaceId),
    index("scene_confluence_sources_page_idx").on(table.workspaceId, table.pageId),
  ],
);

export const sceneConfluenceLocalEdits = sqliteTable(
  "scene_confluence_local_edits",
  {
    sceneId: text("scene_id").primaryKey().references(() => scenes.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    pageId: text("page_id").notNull(),
    html: text("html").notNull(),
    markdown: text("markdown"),
    revision: integer("revision").notNull().default(1),
    updatedByAccountKey: text("updated_by_account_key").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("scene_confluence_local_edits_workspace_idx").on(table.workspaceId, table.sceneId)],
);

export const sceneConfluenceAssets = sqliteTable(
  "scene_confluence_assets",
  {
    assetKey: text("asset_key").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    sceneId: text("scene_id").notNull().references(() => scenes.id, { onDelete: "cascade" }),
    pageId: text("page_id").notNull(),
    originalFilename: text("original_filename").notNull(),
    mime: text("mime").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    generation: text("generation").notNull(),
    provenance: text("provenance", { enum: ["automatic", "manual"] }).notNull().default("automatic"),
    slotKey: text("slot_key"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("scene_confluence_assets_generation_idx").on(table.workspaceId, table.sceneId, table.generation),
    index("scene_confluence_assets_page_idx").on(table.workspaceId, table.sceneId, table.pageId),
  ],
);

export const sceneConfluenceManualAssets = sqliteTable(
  "scene_confluence_manual_assets",
  {
    generation: text("generation").notNull(),
    slotKey: text("slot_key").notNull(),
    assetKey: text("asset_key").notNull().references(() => sceneConfluenceAssets.assetKey, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    sceneId: text("scene_id").notNull().references(() => scenes.id, { onDelete: "cascade" }),
    pageId: text("page_id").notNull(),
    provenance: text("provenance", { enum: ["manual"] }).notNull().default("manual"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.generation, table.slotKey] }),
    index("scene_confluence_manual_assets_scene_idx").on(table.workspaceId, table.sceneId, table.generation),
    uniqueIndex("scene_confluence_manual_assets_asset_idx").on(table.assetKey, table.generation),
  ],
);

export const sceneConfluenceAssetChunks = sqliteTable(
  "scene_confluence_asset_chunks",
  {
    assetKey: text("asset_key").notNull().references(() => sceneConfluenceAssets.assetKey, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    data: blob("data", { mode: "buffer" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.assetKey, table.chunkIndex] })],
);

export const manualImageUploadSessions = sqliteTable(
  "manual_image_upload_sessions",
  {
    uploadId: text("upload_id").primaryKey(),
    assetKey: text("asset_key").notNull().unique(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    sceneId: text("scene_id").notNull().references(() => scenes.id, { onDelete: "cascade" }),
    pageId: text("page_id").notNull(),
    slotKey: text("slot_key").notNull(),
    extension: text("extension").notNull(),
    declaredMime: text("declared_mime").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    chunkCount: integer("chunk_count").notNull(),
    createdByAccountKey: text("created_by_account_key").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("manual_image_upload_sessions_owner_idx").on(table.workspaceId, table.sceneId, table.createdByAccountKey),
    uniqueIndex("manual_image_upload_sessions_retry_idx").on(
      table.workspaceId,
      table.sceneId,
      table.slotKey,
      table.sha256,
      table.createdByAccountKey,
    ),
  ],
);

export const manualImageUploadChunks = sqliteTable(
  "manual_image_upload_chunks",
  {
    uploadId: text("upload_id").notNull().references(() => manualImageUploadSessions.uploadId, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    data: blob("data", { mode: "buffer" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.uploadId, table.chunkIndex] })],
);

export const sceneConfluenceAttachments = sqliteTable(
  "scene_confluence_attachments",
  {
    sceneId: text("scene_id")
      .notNull()
      .references(() => scenes.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    pageId: text("page_id").notNull(),
    attachmentId: text("attachment_id").notNull(),
    filename: text("filename").notNull(),
    mediaType: text("media_type").notNull(),
    fileSize: integer("file_size").notNull(),
    downloadPath: text("download_path").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.sceneId, table.pageId, table.attachmentId] }),
    index("scene_confluence_attachments_lookup_idx").on(
      table.workspaceId,
      table.sceneId,
      table.pageId,
    ),
  ],
);

export const oauthStates = sqliteTable("oauth_states", {
  state: text("state").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  userEmail: text("user_email").notNull(),
  sceneId: text("scene_id").references(() => scenes.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const workspaceInvitations = sqliteTable(
  "workspace_invitations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: ["editor", "viewer"] }).notNull(),
    status: text("status", { enum: ["pending", "accepted", "cancelled"] })
      .notNull()
      .default("pending"),
    invitedBy: text("invited_by").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("workspace_invitations_workspace_idx").on(table.workspaceId),
    index("workspace_invitations_email_idx").on(table.email),
    uniqueIndex("workspace_invitations_pending_unique")
      .on(table.workspaceId, table.email)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export const accountMemberships = sqliteTable(
  "account_memberships",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    accountKey: text("account_key").notNull(),
    role: text("role", { enum: ["owner", "editor", "viewer"] }).notNull(),
    invitedByAccountKey: text("invited_by_account_key"),
    displayName: text("display_name"),
    displayNameUpdatedAt: text("display_name_updated_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.accountKey] }),
    index("account_memberships_account_idx").on(table.accountKey),
  ],
);

export const secureWorkspaceInvites = sqliteTable(
  "secure_workspace_invites",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    role: text("role", { enum: ["editor", "viewer"] }).notNull(),
    status: text("status", { enum: ["active", "used", "cancelled"] }).notNull().default("active"),
    expiresAt: text("expires_at").notNull(),
    createdByAccountKey: text("created_by_account_key").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    usedAt: text("used_at"),
  },
  (table) => [index("secure_workspace_invites_workspace_idx").on(table.workspaceId)],
);

export const workspaceJoinRequests = sqliteTable(
  "workspace_join_requests",
  {
    id: text("id").primaryKey(),
    inviteId: text("invite_id").notNull().references(() => secureWorkspaceInvites.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    applicantAccountKey: text("applicant_account_key").notNull(),
    confirmationCode: text("confirmation_code").notNull(),
    status: text("status", { enum: ["pending", "approved", "rejected", "expired"] }).notNull().default("pending"),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    decidedAt: text("decided_at"),
  },
  (table) => [
    index("workspace_join_requests_workspace_idx").on(table.workspaceId),
    uniqueIndex("workspace_join_requests_pending_unique")
      .on(table.inviteId, table.applicantAccountKey)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export const ownerIdentityMigrations = sqliteTable("owner_identity_migrations", {
  workspaceSlug: text("workspace_slug").primaryKey(),
  migratedAccountKey: text("migrated_account_key").notNull(),
  migratedAt: text("migrated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const workspaceExtensions = sqliteTable("workspace_extensions", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  extensionId: text("extension_id").notNull(), enabled: integer("enabled").notNull().default(0),
}, t => [primaryKey({ columns: [t.workspaceId, t.extensionId] })]);
export const workspaceExtensionProviders = sqliteTable("workspace_extension_providers", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  extensionId: text("extension_id").notNull(),
  sourceWorkspaceId: text("source_workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [primaryKey({ columns: [table.workspaceId, table.extensionId] }),
  index("workspace_extension_providers_source").on(table.sourceWorkspaceId)]);
export const workspaceCustomExtensions = sqliteTable("workspace_custom_extensions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  url: text("url").notNull(),
  groupName: text("group_name").notNull().default("未分類"),
  enabled: integer("enabled").notNull().default(1),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("workspace_custom_extensions_scope").on(table.workspaceId, table.groupName, table.name)]);
export const lllmBridgeJobs = sqliteTable("lllm_bridge_jobs", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  accountKey: text("account_key").notNull(), state: text("state").notNull().default("uploading"),
  requestParts: integer("request_parts").notNull(), responseParts: integer("response_parts").notNull().default(0),
  createdAt: integer("created_at").notNull(), expiresAt: integer("expires_at").notNull(),
}, t => [index("lllm_jobs_pending").on(t.state,t.createdAt)]);
export const lllmBridgeChunks = sqliteTable("lllm_bridge_chunks", {
  jobId: text("job_id").notNull().references(() => lllmBridgeJobs.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(), part: integer("part").notNull(), ciphertext: text("ciphertext").notNull(),
}, t => [primaryKey({ columns: [t.jobId,t.direction,t.part] })]);
export const lllmBridgeState = sqliteTable("lllm_bridge_state", {
  id: text("id").primaryKey(), lastSeen: integer("last_seen").notNull(),
});
export const lllmBrowserAuthorizations = sqliteTable("lllm_browser_authorizations", {
  tokenHash: text("token_hash").primaryKey(),
  kind: text("kind", { enum: ["grant", "session"] }).notNull(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  accountKey: text("account_key").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, table => [index("lllm_browser_authorizations_expiry").on(table.expiresAt),
  index("lllm_browser_authorizations_actor").on(table.workspaceId, table.accountKey, table.kind, table.expiresAt)]);
export const lllmBrowserJobSessions = sqliteTable("lllm_browser_job_sessions", {
  jobId: text("job_id").primaryKey().references(() => lllmBridgeJobs.id, { onDelete: "cascade" }),
  sessionHash: text("session_hash").notNull().references(() => lllmBrowserAuthorizations.tokenHash, { onDelete: "cascade" }),
}, table => [index("lllm_browser_job_sessions_session").on(table.sessionHash)]);
