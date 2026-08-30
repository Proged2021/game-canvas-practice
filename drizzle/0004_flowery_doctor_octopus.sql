CREATE TABLE `account_memberships` (
	`workspace_id` text NOT NULL,
	`account_key` text NOT NULL,
	`role` text NOT NULL,
	`invited_by_account_key` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`workspace_id`, `account_key`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_memberships_account_idx` ON `account_memberships` (`account_key`);--> statement-breakpoint
CREATE TABLE `owner_identity_migrations` (
	`workspace_slug` text PRIMARY KEY NOT NULL,
	`migrated_account_key` text NOT NULL,
	`migrated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `secure_workspace_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` text NOT NULL,
	`created_by_account_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`used_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `secure_workspace_invites_token_hash_unique` ON `secure_workspace_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `secure_workspace_invites_workspace_idx` ON `secure_workspace_invites` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `workspace_join_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`invite_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`applicant_account_key` text NOT NULL,
	`confirmation_code` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`invite_id`) REFERENCES `secure_workspace_invites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workspace_join_requests_workspace_idx` ON `workspace_join_requests` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_join_requests_pending_unique` ON `workspace_join_requests` (`invite_id`,`applicant_account_key`) WHERE "workspace_join_requests"."status" = 'pending';