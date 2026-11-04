CREATE TABLE lllm_browser_authorizations (
 token_hash TEXT PRIMARY KEY NOT NULL,
 kind TEXT NOT NULL,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 account_key TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX lllm_browser_authorizations_expiry ON lllm_browser_authorizations(expires_at);
--> statement-breakpoint
CREATE INDEX lllm_browser_authorizations_actor ON lllm_browser_authorizations(workspace_id,account_key,kind,expires_at);
--> statement-breakpoint
CREATE TABLE lllm_browser_job_sessions (
 job_id TEXT PRIMARY KEY NOT NULL REFERENCES lllm_bridge_jobs(id) ON DELETE CASCADE,
 session_hash TEXT NOT NULL REFERENCES lllm_browser_authorizations(token_hash) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX lllm_browser_job_sessions_session ON lllm_browser_job_sessions(session_hash);
