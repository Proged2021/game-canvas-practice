CREATE TABLE workspace_custom_extensions (
 id TEXT PRIMARY KEY NOT NULL,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 url TEXT NOT NULL,
 group_name TEXT NOT NULL DEFAULT '未分類',
 enabled INTEGER NOT NULL DEFAULT 1,
 revision INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX workspace_custom_extensions_scope ON workspace_custom_extensions(workspace_id,group_name,name);
