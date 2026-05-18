import { relations } from "drizzle-orm";
import { index, pgTableCreator, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `ai-thing_${name}`);

export const projects = createTable(
  "project",
  (d) => ({
    id: d.text("id").primaryKey(),
    userId: d.text("user_id").notNull(),
    name: d.text("name").notNull(),
    isDefault: d.boolean("is_default").notNull().default(false),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: d
      .timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  }),
  (t) => [
    index("project_user_id_idx").on(t.userId),
    uniqueIndex("project_user_name_unique").on(t.userId, t.name),
    index("project_user_default_idx").on(t.userId, t.isDefault),
  ],
);

export const prompts = createTable(
  "prompt",
  (d) => ({
    id: d.text("id").primaryKey(),
    userId: d.text("user_id"),
    projectId: d
      .text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    text: d.text("text").notNull(),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    referenceImages: d.json("reference_ids"), // JSON array of strings
    // TODO: Make this work
    // .references(()=>referenceImages.id, {onDelete: "set null"}) // IDK honestly
    resolution: d.text("resolution"),
    aspectRatio: d.text("aspect_ratio"),
  }),
  (t) => [
    index("prompt_created_at_idx").on(t.createdAt),
    index("prompt_user_id_idx").on(t.userId),
    index("prompt_project_created_at_idx").on(t.projectId, t.createdAt),
  ],
);

export const IMAGE_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
] as const;
export type ImageStatus = (typeof IMAGE_STATUSES)[number];

export const images = createTable(
  "image",
  (d) => ({
    id: d.text("id").primaryKey(),
    userId: d.text("user_id"),
    promptId: d
      .text("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    model: d.text("model").notNull(),
    status: d.text("status").notNull().default("pending").$type<ImageStatus>(),
    url: d.text("url"),
    key: d.text("key"),
    mimeType: d.text("mime_type").notNull().default("image/png"),
    error: d.text("error"),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: d
      .timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  }),
  (t) => [
    index("image_created_at_idx").on(t.createdAt),
    index("image_prompt_id_idx").on(t.promptId),
    index("image_user_id_idx").on(t.userId),
  ],
);

export const referenceImages = createTable(
  "reference",
  (d) => ({
    id: d.text("id").primaryKey(),
    userId: d.text("user_id"),
    url: d.text("url"),
    mimeType: d.text("mime_type").notNull().default("image/png"),
    uploadedAt: d
      .timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reusedFrom: d
      .text("reused_from_image_id")
      .references(() => images.id, { onDelete: "set null" })
      .unique(),
  }),
  (t) => [
    index("reference_user_id_idx").on(t.userId),
    index("reference_reused_from_idx").on(t.reusedFrom),
  ],
);

export const projectsRelations = relations(projects, ({ many }) => ({
  prompts: many(prompts),
}));

export const promptsRelations = relations(prompts, ({ many, one }) => ({
  images: many(images),
  project: one(projects, {
    fields: [prompts.projectId],
    references: [projects.id],
  }),
}));

export const imagesRelations = relations(images, ({ one }) => ({
  prompt: one(prompts, {
    fields: [images.promptId],
    references: [prompts.id],
  }),
}));

export const referenceImageRelations = relations(referenceImages, () => ({}));

export type Prompt = typeof prompts.$inferSelect;
export type Image = typeof images.$inferSelect;
export type ReferenceImage = typeof referenceImages.$inferSelect;
export type Project = typeof projects.$inferSelect;
