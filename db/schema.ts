import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  ownerEmail: text("owner_email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const members = sqliteTable("members", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role", { enum: ["owner", "editor", "viewer"] }).notNull(),
  invitedBy: text("invited_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.email] }),
  index("members_email_idx").on(table.email),
]);

export const scenes = sqliteTable("scenes", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  markdown: text("markdown").notNull().default(""),
  position: integer("position").notNull().default(0),
  revision: integer("revision").notNull().default(1),
  updatedBy: text("updated_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("scenes_workspace_position_idx").on(table.workspaceId, table.position)]);

export const confluenceConnections = sqliteTable("confluence_connections", {
  workspaceId: text("workspace_id").primaryKey().references(() => workspaces.id, { onDelete: "cascade" }),
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
  updatedBy: text("updated_by"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const oauthStates = sqliteTable("oauth_states", {
  state: text("state").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userEmail: text("user_email").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
