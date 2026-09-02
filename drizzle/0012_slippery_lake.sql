CREATE TABLE `scene_confluence_local_edits` (
	`scene_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`page_id` text NOT NULL,
	`html` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_by_account_key` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scene_confluence_local_edits_workspace_idx` ON `scene_confluence_local_edits` (`workspace_id`,`scene_id`);