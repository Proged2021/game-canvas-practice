CREATE TABLE `scene_confluence_asset_chunks` (
	`asset_key` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`data` blob NOT NULL,
	PRIMARY KEY(`asset_key`, `chunk_index`),
	FOREIGN KEY (`asset_key`) REFERENCES `scene_confluence_assets`(`asset_key`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scene_confluence_assets` (
	`asset_key` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`page_id` text NOT NULL,
	`original_filename` text NOT NULL,
	`mime` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`generation` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scene_confluence_assets_generation_idx` ON `scene_confluence_assets` (`workspace_id`,`scene_id`,`generation`);--> statement-breakpoint
CREATE INDEX `scene_confluence_assets_page_idx` ON `scene_confluence_assets` (`workspace_id`,`scene_id`,`page_id`);--> statement-breakpoint
ALTER TABLE `scene_confluence_sources` ADD `asset_generation` text;