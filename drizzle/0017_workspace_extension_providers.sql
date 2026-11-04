CREATE TABLE workspace_extension_providers (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 extension_id TEXT NOT NULL,
 source_workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(workspace_id,extension_id)
);
--> statement-breakpoint
CREATE INDEX workspace_extension_providers_source ON workspace_extension_providers(source_workspace_id);
