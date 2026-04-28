import { sql } from "drizzle-orm";
import { index, sqliteTableCreator } from "drizzle-orm/sqlite-core";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = sqliteTableCreator((name) => `ai-thing_${name}`);

export const images = createTable(
  "image",
  (d) => ({
    id: d.text("id").primaryKey(),
    url: d.text("url").notNull(),
    key: d.text("key").notNull(),
    prompt: d.text("prompt").notNull(),
    model: d.text("model").notNull(),
    createdAt: d
      .integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  }),
  (t) => [index("image_created_at_idx").on(t.createdAt)],
);

export type Image = typeof images.$inferSelect;
