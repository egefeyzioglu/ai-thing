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
    userId: d.text("user_id"),
    text: d.text("text").notNull(),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    referenceImages: d.json("reference_ids"), // JSON array of strings
    // TODO: Make this work
    // .references(()=>referenceImages.id, {onDelete: "set null"}) // IDK honestly
  }),
  (t) => [
    index("prompt_created_at_idx").on(t.createdAt),
    index("prompt_user_id_idx").on(t.userId),
  ],
);

export const IMAGE_STATUSES = ["pending", "succeeded", "failed"] as const;
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
    /** If this reference was created from a generated image, track the source
     *  so we can clean up correctly when either side is deleted later. */
    sourceImageId: d
      .text("source_image_id")
      .references(() => images.id, { onDelete: "set null" }),
    uploadedAt: d
      .timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  }),
  (t) => [index("reference_user_id_idx").on(t.userId)],
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

export const referenceImageRelations = relations(referenceImages, ({ one }) => ({
  sourceImage: one(images, {
    fields: [referenceImages.sourceImageId],
    references: [images.id],
  }),
}));

export type Prompt = typeof prompts.$inferSelect;
export type Image = typeof images.$inferSelect;
export type ReferenceImage = typeof referenceImages.$inferSelect;
