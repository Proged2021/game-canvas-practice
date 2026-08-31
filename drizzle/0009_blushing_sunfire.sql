CREATE TABLE `scene_confluence_manual_assets` (
	`generation` text NOT NULL,
	`slot_key` text NOT NULL,
	`asset_key` text NOT NULL,
	`workspace_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`page_id` text NOT NULL,
	`provenance` text DEFAULT 'manual' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`generation`, `slot_key`),
	FOREIGN KEY (`asset_key`) REFERENCES `scene_confluence_assets`(`asset_key`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scene_confluence_manual_assets_scene_idx` ON `scene_confluence_manual_assets` (`workspace_id`,`scene_id`,`generation`);--> statement-breakpoint
CREATE UNIQUE INDEX `scene_confluence_manual_assets_asset_idx` ON `scene_confluence_manual_assets` (`asset_key`,`generation`);--> statement-breakpoint
ALTER TABLE `scene_confluence_assets` ADD `provenance` text DEFAULT 'automatic' NOT NULL;--> statement-breakpoint
ALTER TABLE `scene_confluence_assets` ADD `slot_key` text;--> statement-breakpoint
ALTER TABLE `scene_confluence_sources` ADD `manual_generation` text;