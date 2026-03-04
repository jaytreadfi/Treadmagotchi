DROP INDEX `outcomes_trade_id`;--> statement-breakpoint
CREATE UNIQUE INDEX `outcomes_trade_id_uniq` ON `trade_outcomes` (`trade_id`);--> statement-breakpoint
ALTER TABLE `pet_state` ADD `egg_id` integer;--> statement-breakpoint
ALTER TABLE `pet_state` ADD `character_id` text;