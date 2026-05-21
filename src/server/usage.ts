import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import {
  calculateGenerationCredits,
  getMonthlyUsageWindow,
  MONTHLY_CREDIT_LIMIT,
} from "src/lib/credits";
import { db } from "src/server/db";
import {
  generationUsage,
  type GenerationUsage,
} from "src/server/db/schema";

type UsageDb = Pick<typeof db, "execute" | "insert" | "select" | "update">;

const COUNTED_USAGE_STATUSES: Array<"reserved" | "consumed"> = [
  "reserved",
  "consumed",
];

export async function lockUserUsage(tx: UsageDb, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
}

export async function getUsedCredits(
  tx: UsageDb,
  userId: string,
  now = new Date(),
): Promise<number> {
  const { periodStart, periodEnd } = getMonthlyUsageWindow(now);
  const [row] = await tx
    .select({
      used: sql<number>`coalesce(sum(${generationUsage.credits}), 0)::int`,
    })
    .from(generationUsage)
    .where(
      and(
        eq(generationUsage.userId, userId),
        gte(generationUsage.createdAt, periodStart),
        lt(generationUsage.createdAt, periodEnd),
        inArray(generationUsage.status, COUNTED_USAGE_STATUSES),
      ),
    );

  return Number(row?.used ?? 0);
}

export async function getCurrentUsage(userId: string) {
  const now = new Date();
  const { periodStart, periodEnd } = getMonthlyUsageWindow(now);
  const used = await getUsedCredits(db, userId, now);
  const recent = await db
    .select({
      id: generationUsage.id,
      imageId: generationUsage.imageId,
      model: generationUsage.model,
      resolution: generationUsage.resolution,
      aspectRatio: generationUsage.aspectRatio,
      credits: generationUsage.credits,
      status: generationUsage.status,
      createdAt: generationUsage.createdAt,
      updatedAt: generationUsage.updatedAt,
    })
    .from(generationUsage)
    .where(
      and(
        eq(generationUsage.userId, userId),
        gte(generationUsage.createdAt, periodStart),
        lt(generationUsage.createdAt, periodEnd),
      ),
    )
    .orderBy(desc(generationUsage.createdAt))
    .limit(20);

  return {
    periodStart,
    periodEnd,
    limit: MONTHLY_CREDIT_LIMIT,
    used,
    remaining: Math.max(MONTHLY_CREDIT_LIMIT - used, 0),
    isOverQuota: used >= MONTHLY_CREDIT_LIMIT,
    recent,
  };
}

export function calculateUsageRowCredits(args: {
  model: string;
  resolution?: string | null;
  aspectRatio?: string | null;
}) {
  return calculateGenerationCredits(args);
}

export async function createReservedUsage(tx: UsageDb, args: {
  userId: string;
  imageId: string;
  model: string;
  resolution?: string | null;
  aspectRatio?: string | null;
}): Promise<GenerationUsage> {
  const credits = calculateUsageRowCredits(args);
  const [usageRow] = await tx
    .insert(generationUsage)
    .values({
      id: crypto.randomUUID(),
      userId: args.userId,
      imageId: args.imageId,
      model: args.model,
      resolution: args.resolution,
      aspectRatio: args.aspectRatio,
      credits,
      status: "reserved",
    })
    .returning();

  if (!usageRow) {
    throw new Error("Failed to insert usage row");
  }

  return usageRow;
}

export async function markUsageStatus(
  usageId: string | undefined,
  status: "consumed" | "refunded",
): Promise<boolean> {
  if (!usageId) return false;

  const [updated] = await db
    .update(generationUsage)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(generationUsage.id, usageId),
        eq(generationUsage.status, "reserved"),
      ),
    )
    .returning({ id: generationUsage.id });

  return !!updated;
}
