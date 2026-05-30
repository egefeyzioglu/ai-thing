import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "src/server/api/trpc";
import { db } from "src/server/db";
import { projects, type Project } from "src/server/db/schema";
import { getPostHogClient } from "src/lib/posthog-server";

const DEFAULT_PROJECT_NAME = "Default Project";
const PROJECT_NAME_MAX_LENGTH = 80;

const projectNameSchema = z
  .string()
  .transform((name) => name.trim())
  .pipe(z.string().min(1).max(PROJECT_NAME_MAX_LENGTH));

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

async function listProjectsForUser(userId: string) {
  return db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.isDefault), asc(projects.createdAt));
}

async function ensureProjectForUser(userId: string): Promise<Project[]> {
  const existing = await listProjectsForUser(userId);
  if (existing.length > 0) return existing;

  try {
    await db.insert(projects).values({
      id: crypto.randomUUID(),
      userId,
      name: DEFAULT_PROJECT_NAME,
      isDefault: true,
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  return listProjectsForUser(userId);
}

export const projectRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ensureProjectForUser(ctx.user);
  }),

  create: protectedProcedure
    .input(z.object({ name: projectNameSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        const [project] = await db
          .insert(projects)
          .values({
            id: crypto.randomUUID(),
            userId: ctx.user,
            name: input.name,
            isDefault: false,
          })
          .returning();

        if (!project) throw new Error("Failed to create project");
        getPostHogClient().capture({
          distinctId: ctx.user,
          event: "project_created",
          properties: { project_id: project.id, project_name: project.name },
        });
        return project;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A project with that name already exists",
          });
        }

        throw error;
      }
    }),

  rename: protectedProcedure
    .input(z.object({ id: z.string().min(1), name: projectNameSchema }))
    .mutation(async ({ ctx, input }) => {
      const [existingProject] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, input.id), eq(projects.userId, ctx.user)))
        .limit(1);

      if (!existingProject) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      if (existingProject.name === input.name) return existingProject;

      try {
        const [project] = await db
          .update(projects)
          .set({ name: input.name, updatedAt: new Date() })
          .where(and(eq(projects.id, input.id), eq(projects.userId, ctx.user)))
          .returning();

        if (!project) throw new Error("Failed to rename project");
        getPostHogClient().capture({
          distinctId: ctx.user,
          event: "project_renamed",
          properties: { project_id: project.id, new_name: project.name },
        });
        return project;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A project with that name already exists",
          });
        }

        throw error;
      }
    }),
});
