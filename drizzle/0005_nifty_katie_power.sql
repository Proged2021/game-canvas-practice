CREATE TABLE `confluence_attachments` (
	`workspace_id` text NOT NULL,
	`page_id` text NOT NULL,
	`attachment_id` text NOT NULL,
	`filename` text NOT NULL,
	`media_type` text NOT NULL,
	`file_size` integer NOT NULL,
	`download_path` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`workspace_id`, `page_id`, `attachment_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `confluence_attachments_page_idx` ON `confluence_attachments` (`workspace_id`,`page_id`);--> statement-breakpoint
ALTER TABLE `confluence_connections` ADD `attachment_scope_granted` integer DEFAULT 0 NOT NULL;