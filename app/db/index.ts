// CloudflareのDBを、アプリからDrizzleで使うためのファイル
// DrizzleはORMの一種
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
    }
  }
}

export function getDb() {
  return drizzle(env.DB, { schema });
}