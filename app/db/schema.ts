import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// 練習用の表示名を保存する
export const practiceNames = sqliteTable("practice_names", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  displayName: text("display_name").notNull(),
});

// 認証用テーブルの定義を読み込む
export * from "./auth-schema";