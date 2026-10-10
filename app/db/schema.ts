import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const practiceNames = sqliteTable("practice_names", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  displayName: text("display_name").notNull(),
});