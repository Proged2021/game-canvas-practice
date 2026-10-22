CREATE TABLE workspace_extensions (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 extension_id TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(workspace_id,extension_id)
);
--> statement-breakpoint
CREATE TABLE lllm_bridge_jobs (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 account_key TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'uploading',
 request_parts INTEGER NOT NULL, response_parts INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX lllm_jobs_pending ON lllm_bridge_jobs(state,created_at);
--> statement-breakpoint
CREATE TABLE lllm_bridge_chunks (
 job_id TEXT NOT NULL REFERENCES lllm_bridge_jobs(id) ON DELETE CASCADE,
 direction TEXT NOT NULL, part INTEGER NOT NULL, ciphertext TEXT NOT NULL,
 PRIMARY KEY(job_id,direction,part)
);
--> statement-breakpoint
CREATE TABLE lllm_bridge_state (id TEXT PRIMARY KEY,last_seen INTEGER NOT NULL);
--> statement-breakpoint
UPDATE workspaces SET name='水無墓村',updated_at=CURRENT_TIMESTAMP
WHERE id='0279e5f9-6122-4fb9-90ff-b9073a9fc7c1' AND slug='minamomura' AND name='水面村';
--> statement-breakpoint
INSERT INTO workspace_extensions(workspace_id,extension_id,enabled)
SELECT id,'lllm',1 FROM workspaces WHERE id='0279e5f9-6122-4fb9-90ff-b9073a9fc7c1';
