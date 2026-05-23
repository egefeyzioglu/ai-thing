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

export const GENERATION_USAGE_STATUSES = [
  "reserved",
  "consumed",
  "refunded",
] as const;
export type GenerationUsageStatus = (typeof GENERATION_USAGE_STATUSES)[number];

export const GENERATION_COST_EVENT_STATUSES = [
  "recorded",
  "estimated",
  "missing_usage",
] as const;
export type GenerationCostEventStatus =
  (typeof GENERATION_COST_EVENT_STATUSES)[number];

export const GENERATION_COST_EVENT_OPERATIONS = [
  "image_generation",
  "image_edit",
  "responses_image_generation",
] as const;
export type GenerationCostEventOperation =
  (typeof GENERATION_COST_EVENT_OPERATIONS)[number];

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

export const generationUsage = createTable(
  "generation_usage",
  (d) => ({
    id: d.text("id").primaryKey(),
    userId: d.text("user_id").notNull(),
    imageId: d
      .text("image_id")
      .references(() => images.id, { onDelete: "set null" }),
    model: d.text("model").notNull(),
    resolution: d.text("resolution"),
    aspectRatio: d.text("aspect_ratio"),
    credits: d.integer("credits").notNull(),
    status: d
      .text("status")
      .notNull()
      .default("reserved")
      .$type<GenerationUsageStatus>(),
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
    index("generation_usage_user_created_idx").on(t.userId, t.createdAt),
    index("generation_usage_user_status_created_idx").on(
      t.userId,
      t.status,
      t.createdAt,
    ),
    index("generation_usage_image_idx").on(t.imageId),
  ],
);

export const generationCostEvents = createTable(
  "generation_cost_event",
  (d) => ({
    id: d.text("id").primaryKey(),
    userId: d.text("user_id").notNull(),
    imageId: d
      .text("image_id")
      .references(() => images.id, { onDelete: "set null" }),
    provider: d.text("provider").notNull(),
    providerRequestId: d.text("provider_request_id"),
    model: d.text("model").notNull(),
    providerModel: d.text("provider_model"),
    operation: d
      .text("operation")
      .notNull()
      .$type<GenerationCostEventOperation>(),
    status: d
      .text("status")
      .notNull()
      .default("recorded")
      .$type<GenerationCostEventStatus>(),
    pricingVersion: d.text("pricing_version").notNull(),
    costUsdMicros: d.bigint("cost_usd_micros", { mode: "number" }).notNull(),
    currency: d.text("currency").notNull().default("USD"),
    inputTextTokens: d.integer("input_text_tokens"),
    inputImageTokens: d.integer("input_image_tokens"),
    inputTokens: d.integer("input_tokens"),
    cachedInputTokens: d.integer("cached_input_tokens"),
    outputTextTokens: d.integer("output_text_tokens"),
    outputImageTokens: d.integer("output_image_tokens"),
    outputTokens: d.integer("output_tokens"),
    reasoningTokens: d.integer("reasoning_tokens"),
    totalTokens: d.integer("total_tokens"),
    outputImageCount: d.integer("output_image_count"),
    fallbackReason: d.text("fallback_reason"),
    usageRaw: d.json("usage_raw"),
    costCalculationRaw: d.json("cost_calculation_raw"),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  }),
  (t) => [
    index("generation_cost_event_user_created_idx").on(t.userId, t.createdAt),
    index("generation_cost_event_image_idx").on(t.imageId),
    index("generation_cost_event_provider_created_idx").on(
      t.provider,
      t.createdAt,
    ),
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
export const generationUsageRelations = relations(generationUsage, ({ one }) => ({
  image: one(images, {
    fields: [generationUsage.imageId],
    references: [images.id],
  }),
}));
export const generationCostEventsRelations = relations(
  generationCostEvents,
  ({ one }) => ({
    image: one(images, {
      fields: [generationCostEvents.imageId],
      references: [images.id],
    }),
  }),
);

export type Prompt = typeof prompts.$inferSelect;
export type Image = typeof images.$inferSelect;
export type ReferenceImage = typeof referenceImages.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type GenerationUsage = typeof generationUsage.$inferSelect;
export type GenerationCostEvent = typeof generationCostEvents.$inferSelect;
