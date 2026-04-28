import { relations } from "drizzle-orm";
import { index, pgTableCreator } from "drizzle-orm/pg-core";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `ai-thing_${name}`);

export const prompts = createTable(
  "prompt",
  (d) => ({
    id: d.text("id").primaryKey(),
    text: d.text("text").notNull(),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  }),
  (t) => [index("prompt_created_at_idx").on(t.createdAt)],
);

export const images = createTable(
  "image",
  (d) => ({
    id: d.text("id").primaryKey(),
    promptId: d
      .text("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    url: d.text("url").notNull(),
    key: d.text("key").notNull(),
    model: d.text("model").notNull(),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  }),
  (t) => [
    index("image_created_at_idx").on(t.createdAt),
    index("image_prompt_id_idx").on(t.promptId),
  ],
);

export const promptsRelations = relations(prompts, ({ many }) => ({
  images: many(images),
}));

export const imagesRelations = relations(images, ({ one }) => ({
  prompt: one(prompts, {
    fields: [images.promptId],
    references: [prompts.id],
  }),
}));

/**
 * Auth tables.
 *
 * There is no admin panel and no signup endpoint: users are managed by
 * editing this table directly. To create a user, insert a row with a
 * scrypt-hashed password. See `scripts/hash-password.mjs`.
 */
export const users = createTable(
  "user",
  (d) => ({
    id: d.text("id").primaryKey(),
    username: d.text("username").notNull().unique(),
    passwordHash: d.text("password_hash").notNull(),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  }),
  (t) => [index("user_username_idx").on(t.username)],
);

export const sessions = createTable(
  "session",
  (d) => ({
    id: d.text("id").primaryKey(),
    userId: d
      .text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: d
      .timestamp("expires_at", { withTimezone: true })
      .notNull(),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  }),
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export type Prompt = typeof prompts.$inferSelect;
export type Image = typeof images.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
