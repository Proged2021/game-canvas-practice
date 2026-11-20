ALTER TABLE `account_memberships` ADD `display_name` text;--> statement-breakpoint
ALTER TABLE `account_memberships` ADD `display_name_updated_at` text;--> statement-breakpoint
ALTER TABLE `scenes` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `scenes` ADD `delete_expires_at` text;--> statement-breakpoint
ALTER TABLE `scenes` ADD `deleted_by_account_key` text;