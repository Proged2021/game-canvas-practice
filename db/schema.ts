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
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("scene_confluence_sources_workspace_idx").on(table.workspaceId),
    index("scene_confluence_sources_page_idx").on(table.workspaceId, table.pageId),
  ],
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
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("scene_confluence_assets_generation_idx").on(table.workspaceId, table.sceneId, table.generation),
    index("scene_confluence_assets_page_idx").on(table.workspaceId, table.sceneId, table.pageId),
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
