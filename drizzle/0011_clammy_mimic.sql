CREATE TABLE `manual_image_upload_chunks` (
	`upload_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`data` blob NOT NULL,
	PRIMARY KEY(`upload_id`, `chunk_index`),
	FOREIGN KEY (`upload_id`) REFERENCES `manual_image_upload_sessions`(`upload_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `manual_image_upload_sessions` (
	`upload_id` text PRIMARY KEY NOT NULL,
	`asset_key` text NOT NULL,
	`workspace_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`page_id` text NOT NULL,
	`slot_key` text NOT NULL,
	`extension` text NOT NULL,
	`declared_mime` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`chunk_count` integer NOT NULL,
	`created_by_account_key` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `manual_image_upload_sessions_asset_key_unique` ON `manual_image_upload_sessions` (`asset_key`);--> statement-breakpoint
CREATE INDEX `manual_image_upload_sessions_owner_idx` ON `manual_image_upload_sessions` (`workspace_id`,`scene_id`,`created_by_account_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `manual_image_upload_sessions_retry_idx` ON `manual_image_upload_sessions` (`workspace_id`,`scene_id`,`slot_key`,`sha256`,`created_by_account_key`);