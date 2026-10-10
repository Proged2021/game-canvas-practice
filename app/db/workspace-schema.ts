import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

// ワークスペースを保存する
export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// ユーザーの所属・表示名・権限を保存する
export const workspaceMemberships = sqliteTable(
  "workspace_memberships",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["owner", "editor", "viewer"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    // 同じユーザーが同じ場所に重複して所属するのを防ぐ
    primaryKey({ columns: [table.workspaceId, table.userId] }),

    // ユーザーが所属するワークスペースを探しやすくする
    index("workspace_memberships_user_id_idx").on(table.userId),

    // 決めた3種類以外の権限を保存できなくする
    check(
      "workspace_memberships_role_check",
      sql`${table.role} IN ('owner', 'editor', 'viewer')`
    ),
  ]
);