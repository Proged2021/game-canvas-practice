CREATE TABLE `scene_confluence_attachments` (
	`scene_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`page_id` text NOT NULL,
	`attachment_id` text NOT NULL,
	`filename` text NOT NULL,
	`media_type` text NOT NULL,
	`file_size` integer NOT NULL,
	`download_path` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`scene_id`, `page_id`, `attachment_id`),
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scene_confluence_attachments_lookup_idx` ON `scene_confluence_attachments` (`workspace_id`,`scene_id`,`page_id`);--> statement-breakpoint
CREATE TABLE `scene_confluence_sources` (
	`scene_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`page_id` text NOT NULL,
	`page_url` text NOT NULL,
	`page_title` text NOT NULL,
	`page_version` integer NOT NULL,
	`synced_html` text NOT NULL,
	`last_synced_at` text NOT NULL,
	`last_checked_at` text,
	`last_error` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scene_confluence_sources_workspace_idx` ON `scene_confluence_sources` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `scene_confluence_sources_page_idx` ON `scene_confluence_sources` (`workspace_id`,`page_id`);--> statement-breakpoint
INSERT INTO `scene_confluence_sources`
  (`scene_id`,`workspace_id`,`page_id`,`page_url`,`page_title`,`page_version`,`synced_html`,`last_synced_at`,`last_checked_at`,`last_error`)
SELECT
  (SELECT s.id FROM scenes s WHERE s.workspace_id=c.workspace_id
   ORDER BY CASE
     WHEN s.title=c.page_title THEN 0
     WHEN s.confluence_page_url=c.page_url THEN 1
     ELSE 2 END,
     s.position DESC, s.created_at DESC LIMIT 1),
  c.workspace_id,c.page_id,c.page_url,c.page_title,c.page_version,c.synced_html,
  c.last_synced_at,c.last_checked_at,c.last_error
FROM confluence_connections c
WHERE c.page_id IS NOT NULL AND c.page_url IS NOT NULL AND c.page_title IS NOT NULL
  AND c.page_version IS NOT NULL AND c.synced_html IS NOT NULL AND c.last_synced_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM scenes s WHERE s.workspace_id=c.workspace_id);--> statement-breakpoint
INSERT INTO `scene_confluence_attachments`
  (`scene_id`,`workspace_id`,`page_id`,`attachment_id`,`filename`,`media_type`,`file_size`,`download_path`,`updated_at`)
SELECT src.scene_id,a.workspace_id,a.page_id,a.attachment_id,a.filename,a.media_type,a.file_size,a.download_path,a.updated_at
FROM confluence_attachments a
JOIN scene_confluence_sources src ON src.workspace_id=a.workspace_id AND src.page_id=a.page_id;
