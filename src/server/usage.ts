import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";

import {
  calculateGenerationCredits,
  getMonthlyUsageWindow,
  MONTHLY_CREDIT_LIMIT,
} from "src/lib/credits";
import { db } from "src/server/db";
import {
  generationCostEvents,
  generationUsage,
  type GenerationUsage,
} from "src/server/db/schema";
import { formatUsdMicros } from "src/server/generation-costs";

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

export async function getMonthlyCostUsdMicros(
  tx: UsageDb,
  userId: string,
  now = new Date(),
): Promise<{
  totalUsdMicros: number;
  estimatedUsdMicros: number;
}> {
  const { periodStart, periodEnd } = getMonthlyUsageWindow(now);
  const [row] = await tx
    .select({
      totalUsdMicros: sql<number>`coalesce(sum(${generationCostEvents.costUsdMicros}), 0)::bigint`,
      estimatedUsdMicros: sql<number>`coalesce(sum(case when ${generationCostEvents.status} = 'estimated' then ${generationCostEvents.costUsdMicros} else 0 end), 0)::bigint`,
    })
    .from(generationCostEvents)
    .where(
      and(
        eq(generationCostEvents.userId, userId),
        gte(generationCostEvents.createdAt, periodStart),
        lt(generationCostEvents.createdAt, periodEnd),
      ),
    );

  return {
    totalUsdMicros: Number(row?.totalUsdMicros ?? 0),
    estimatedUsdMicros: Number(row?.estimatedUsdMicros ?? 0),
  };
}

export async function getCurrentUsage(userId: string) {
  const now = new Date();
  const { periodStart, periodEnd } = getMonthlyUsageWindow(now);
  const used = await getUsedCredits(db, userId, now);
  const monthlyCost = await getMonthlyCostUsdMicros(db, userId, now);
  const recent = await db
    .select({
      id: generationUsage.id,
      imageId: generationUsage.imageId,
      model: generationUsage.model,
      resolution: generationUsage.resolution,
      aspectRatio: generationUsage.aspectRatio,
      credits: generationUsage.credits,
      usageType: generationUsage.usageType,
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
  const recentImageIds = recent
    .map((row) => row.imageId)
    .filter((imageId): imageId is string => !!imageId);
  const recentUsageIds = recent.map((row) => row.id);
  const costRows = recentUsageIds.length
    ? await db
        .select({
          usageId: generationCostEvents.usageId,
          imageId: generationCostEvents.imageId,
          costUsdMicros: generationCostEvents.costUsdMicros,
          costStatus: generationCostEvents.status,
          costPricingVersion: generationCostEvents.pricingVersion,
          createdAt: generationCostEvents.createdAt,
        })
        .from(generationCostEvents)
        .where(
          and(
            eq(generationCostEvents.userId, userId),
            recentImageIds.length
              ? or(
                  inArray(generationCostEvents.usageId, recentUsageIds),
                  inArray(generationCostEvents.imageId, recentImageIds),
                )
              : inArray(generationCostEvents.usageId, recentUsageIds),
          ),
        )
        .orderBy(desc(generationCostEvents.createdAt))
    : [];
  const latestCostByImageId = new Map<
    string,
    {
      costUsdMicros: number;
      costStatus: "recorded" | "estimated" | "missing_usage";
      costPricingVersion: string;
    }
  >();
  const latestCostByUsageId = new Map<
    string,
    {
      costUsdMicros: number;
      costStatus: "recorded" | "estimated" | "missing_usage";
      costPricingVersion: string;
    }
  >();

  for (const row of costRows) {
    if (row.usageId && !latestCostByUsageId.has(row.usageId)) {
      latestCostByUsageId.set(row.usageId, {
        costUsdMicros: row.costUsdMicros,
        costStatus: row.costStatus,
        costPricingVersion: row.costPricingVersion,
      });
    }
    if (!row.imageId || latestCostByImageId.has(row.imageId)) continue;
    latestCostByImageId.set(row.imageId, {
      costUsdMicros: row.costUsdMicros,
      costStatus: row.costStatus,
      costPricingVersion: row.costPricingVersion,
    });
  }
  const recentWithCosts = recent.map((row) => {
    const cost =
      latestCostByUsageId.get(row.id) ??
      (row.imageId ? latestCostByImageId.get(row.imageId) : undefined);
    return {
      ...row,
      kind:
        row.usageType === "workshop_message"
          ? ("workshop" as const)
          : ("image" as const),
      count: 1,
      costUsdMicros: cost?.costUsdMicros ?? null,
      costStatus: cost?.costStatus ?? null,
      costPricingVersion: cost?.costPricingVersion ?? null,
    };
  });

  return {
    periodStart,
    periodEnd,
    limit: MONTHLY_CREDIT_LIMIT,
    used,
    remaining: Math.max(MONTHLY_CREDIT_LIMIT - used, 0),
    isOverQuota: used >= MONTHLY_CREDIT_LIMIT,
    cost: {
      totalUsdMicros: monthlyCost.totalUsdMicros,
      estimatedUsdMicros: monthlyCost.estimatedUsdMicros,
      formattedTotal: formatUsdMicros(monthlyCost.totalUsdMicros),
      hasEstimated: monthlyCost.estimatedUsdMicros > 0,
    },
    recent: groupAdjacentWorkshopUsage(recentWithCosts),
  };
}

function groupAdjacentWorkshopUsage<
  T extends {
    id: string;
    imageId: string | null;
    model: string;
    resolution: string | null;
    aspectRatio: string | null;
    credits: number;
    usageType: GenerationUsage["usageType"];
    createdAt: Date;
    updatedAt: Date;
    status: GenerationUsage["status"];
    kind: "image" | "workshop";
    count: number;
    costUsdMicros: number | null;
    costStatus: "recorded" | "estimated" | "missing_usage" | null;
    costPricingVersion: string | null;
  },
>(rows: T[]): T[] {
  const grouped: T[] = [];

  for (const row of rows) {
    const previous = grouped.at(-1);
    if (
      previous?.kind === "workshop" &&
      row.kind === "workshop" &&
      previous.model === row.model &&
      previous.status === row.status
    ) {
      previous.id = `${previous.id}:${row.id}`;
      previous.credits += row.credits;
      previous.count += row.count;
      previous.createdAt =
        previous.createdAt > row.createdAt ? previous.createdAt : row.createdAt;
      previous.updatedAt =
        previous.updatedAt > row.updatedAt ? previous.updatedAt : row.updatedAt;
      previous.costUsdMicros =
        previous.costUsdMicros === null || row.costUsdMicros === null
          ? null
          : previous.costUsdMicros + row.costUsdMicros;
      previous.costStatus =
        previous.costStatus === "estimated" || row.costStatus === "estimated"
          ? "estimated"
          : (previous.costStatus ?? row.costStatus);
      continue;
    }

    grouped.push({ ...row });
  }

  return grouped;
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
  imageId?: string | null;
  model: string;
  resolution?: string | null;
  aspectRatio?: string | null;
  credits?: number;
  usageType?: GenerationUsage["usageType"];
}): Promise<GenerationUsage> {
  const credits = args.credits ?? calculateUsageRowCredits(args);
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
      usageType: args.usageType,
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
