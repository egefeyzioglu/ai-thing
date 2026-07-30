import { relations } from "drizzle-orm";
import { index, pgTableCreator, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `ai-thing_${name}`);

export const observabilityRateLimits = createTable(
  "observability_rate_limit",
  (d) => ({
    key: d.text("key").primaryKey(),
    count: d.integer("count").notNull(),
    windowStartedAt: d
      .timestamp("window_started_at", { withTimezone: true })
      .notNull(),
  }),
);

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
    quality: d.text("quality"),
    background: d.text("background"),
    negativePrompt: d.text("negative_prompt"),
    seed: d.text("seed"),
    thinking: d.text("thinking"),
  }),
  (t) => [
    index("prompt_created_at_idx").on(t.createdAt),
    index("prompt_user_id_idx").on(t.userId),
    index("prompt_project_created_at_idx").on(t.projectId, t.createdAt),
  ],
);

export const MEDIA_TYPES = ["image", "video"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const MEDIA_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];
export type SeedreamResizePolicy = "35mp-v1";

export const GENERATION_USAGE_STATUSES = [
  "reserved",
  "consumed",
  "refunded",
] as const;
export type GenerationUsageStatus = (typeof GENERATION_USAGE_STATUSES)[number];

export const GENERATION_USAGE_TYPES = [
  "image_generation",
  "video_generation",
  "workshop_message",
] as const;
export type GenerationUsageType = (typeof GENERATION_USAGE_TYPES)[number];

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
  "video_generation",
  "workshop_message",
] as const;
export type GenerationCostEventOperation =
  (typeof GENERATION_COST_EVENT_OPERATIONS)[number];

export const WORKSHOP_MESSAGE_ROLES = [
  "user",
  "assistant",
  "reasoning_summary",
  "suggest_prompt",
] as const;
export type WorkshopMessageRole = (typeof WORKSHOP_MESSAGE_ROLES)[number];

export const media = createTable(
  "media",
  (d) => ({
    id: d.text("id").primaryKey(),
    userId: d.text("user_id"),
    promptId: d
      .text("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    type: d.text("type").notNull().$type<MediaType>(),
    model: d.text("model").notNull(),
    status: d.text("status").notNull().default("pending").$type<MediaStatus>(),
    providerStatus: d.text("provider_status"),
    url: d.text("url"),
    key: d.text("key"),
    mimeType: d.text("mime_type").notNull(),
    durationMs: d.integer("duration_ms"),
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
    index("media_created_at_idx").on(t.createdAt),
    index("media_prompt_id_idx").on(t.promptId),
    index("media_user_type_created_idx").on(t.userId, t.type, t.createdAt),
  ],
);

export const referenceImages = createTable(
  "reference",
  (d) => ({
    id: d.text("id").primaryKey(),
    userId: d.text("user_id"),
    url: d.text("url"),
    mimeType: d.text("mime_type").notNull().default("image/png"),
    width: d.integer("width"),
    height: d.integer("height"),
    seedreamUrl: d.text("seedream_url"),
    seedreamKey: d.text("seedream_key"),
    seedreamWidth: d.integer("seedream_width"),
    seedreamHeight: d.integer("seedream_height"),
    seedreamResizePolicy: d
      .text("seedream_resize_policy")
      .$type<SeedreamResizePolicy>(),
    uploadedAt: d
      .timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reusedFromMediaId: d
      .text("reused_from_media_id")
      .references(() => media.id, { onDelete: "set null" })
      .unique(),
  }),
  (t) => [
    index("reference_user_id_idx").on(t.userId),
    index("reference_reused_from_media_idx").on(t.reusedFromMediaId),
  ],
);

export const generationUsage = createTable(
  "generation_usage",
  (d) => ({
    id: d.text("id").primaryKey(),
    userId: d.text("user_id").notNull(),
    mediaId: d
      .text("media_id")
      .references(() => media.id, { onDelete: "set null" }),
    model: d.text("model").notNull(),
    requestedResolution: d.text("requested_resolution"),
    resolution: d.text("resolution"),
    aspectRatio: d.text("aspect_ratio"),
    credits: d.integer("credits").notNull(),
    usageType: d
      .text("usage_type")
      .notNull()
      .default("image_generation")
      .$type<GenerationUsageType>(),
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
    index("generation_usage_media_idx").on(t.mediaId),
  ],
);

export const generationCostEvents = createTable(
  "generation_cost_event",
  (d) => ({
    id: d.text("id").primaryKey(),
    userId: d.text("user_id").notNull(),
    mediaId: d
      .text("media_id")
      .references(() => media.id, { onDelete: "set null" }),
    usageId: d
      .text("usage_id")
      .references(() => generationUsage.id, { onDelete: "set null" }),
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
    outputCount: d.integer("output_count"),
    outputDurationMs: d.integer("output_duration_ms"),
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
    index("generation_cost_event_media_idx").on(t.mediaId),
    index("generation_cost_event_usage_idx").on(t.usageId),
    index("generation_cost_event_provider_created_idx").on(
      t.provider,
      t.createdAt,
    ),
  ],
);

export const workshopThreads = createTable(
  "workshop_thread",
  (d) => ({
    id: d.text("id").primaryKey(),
    userId: d.text("user_id").notNull(),
    projectId: d
      .text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    title: d.text("title").notNull(),
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
    index("workshop_thread_user_project_updated_idx").on(
      t.userId,
      t.projectId,
      t.updatedAt,
    ),
    index("workshop_thread_project_updated_idx").on(t.projectId, t.updatedAt),
  ],
);

export const workshopMessages = createTable(
  "workshop_message",
  (d) => ({
    id: d.text("id").primaryKey(),
    userId: d.text("user_id").notNull(),
    projectId: d
      .text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    threadId: d
      .text("thread_id")
      .notNull()
      .references(() => workshopThreads.id, { onDelete: "cascade" }),
    role: d.text("role").notNull().$type<WorkshopMessageRole>(),
    model: d.text("model"),
    content: d.text("content").notNull(),
    referenceImages: d.json("reference_ids").$type<string[] | null>(),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  }),
  (t) => [
    index("workshop_message_thread_created_idx").on(t.threadId, t.createdAt),
    index("workshop_message_user_project_created_idx").on(
      t.userId,
      t.projectId,
      t.createdAt,
    ),
    index("workshop_message_project_created_idx").on(t.projectId, t.createdAt),
  ],
);

export const projectsRelations = relations(projects, ({ many }) => ({
  prompts: many(prompts),
  workshopThreads: many(workshopThreads),
  workshopMessages: many(workshopMessages),
}));

export const promptsRelations = relations(prompts, ({ many, one }) => ({
  media: many(media),
  project: one(projects, {
    fields: [prompts.projectId],
    references: [projects.id],
  }),
}));

export const mediaRelations = relations(media, ({ one }) => ({
  prompt: one(prompts, {
    fields: [media.promptId],
    references: [prompts.id],
  }),
}));

export const referenceImageRelations = relations(referenceImages, () => ({}));
export const generationUsageRelations = relations(
  generationUsage,
  ({ one }) => ({
    media: one(media, {
      fields: [generationUsage.mediaId],
      references: [media.id],
    }),
  }),
);
export const generationCostEventsRelations = relations(
  generationCostEvents,
  ({ one }) => ({
    media: one(media, {
      fields: [generationCostEvents.mediaId],
      references: [media.id],
    }),
    usage: one(generationUsage, {
      fields: [generationCostEvents.usageId],
      references: [generationUsage.id],
    }),
  }),
);
export const workshopMessagesRelations = relations(
  workshopMessages,
  ({ one }) => ({
    project: one(projects, {
      fields: [workshopMessages.projectId],
      references: [projects.id],
    }),
    thread: one(workshopThreads, {
      fields: [workshopMessages.threadId],
      references: [workshopThreads.id],
    }),
  }),
);
export const workshopThreadsRelations = relations(
  workshopThreads,
  ({ many, one }) => ({
    project: one(projects, {
      fields: [workshopThreads.projectId],
      references: [projects.id],
    }),
    messages: many(workshopMessages),
  }),
);

export type Prompt = typeof prompts.$inferSelect;
export type Media = typeof media.$inferSelect;
export type ImageMedia = Media & { type: "image" };
export type VideoMedia = Media & { type: "video" };
export type ReferenceImage = typeof referenceImages.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type GenerationUsage = typeof generationUsage.$inferSelect;
export type GenerationCostEvent = typeof generationCostEvents.$inferSelect;
export type WorkshopMessage = typeof workshopMessages.$inferSelect;
export type WorkshopThread = typeof workshopThreads.$inferSelect;
