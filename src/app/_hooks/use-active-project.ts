"use client";

import { useCallback, useEffect } from "react";
import { useUser } from "@clerk/nextjs";

import { useLocalStorage, type LocalStorageValue } from "src/lib/localStorage";
import type { RouterOutputs } from "src/trpc/react";

type ProjectList = RouterOutputs["project"]["list"];

export function useActiveProject(projects: ProjectList | undefined) {
  const user = useUser();
  const userId = user.user?.id;
  const [selectedProjectIds, setSelectedProjectIds] =
    useLocalStorage("activeProject");

  const selectedProjectId =
    selectedProjectIds.find(({ userId: thisUserId }) => thisUserId === userId)
      ?.projectId ?? null;
  const selectedProject = projects?.find(
    (project) => project.id === selectedProjectId,
  );

  const handleSelectProject = useCallback(
    (projectId: string) => {
      if (!userId) return;

      setSelectedProjectIds((prev: LocalStorageValue<"activeProject">) => {
        if (prev.some(({ userId: thisUserId }) => thisUserId === userId)) {
          return prev.map((activeProject) =>
            activeProject.userId === userId
              ? { ...activeProject, projectId }
              : activeProject,
          );
        }

        return [...prev, { userId, projectId }];
      });
    },
    [setSelectedProjectIds, userId],
  );

  useEffect(() => {
    if (!userId || !projects) return;
    if (projects.length === 0) {
      setSelectedProjectIds((prev) =>
        prev.filter(({ userId: thisUserId }) => thisUserId !== userId),
      );
      return;
    }

    if (
      selectedProjectId &&
      projects.some((project) => project.id === selectedProjectId)
    ) {
      return;
    }

    const fallbackProjectId =
      projects.find((project) => project.isDefault)?.id ?? projects[0]?.id;

    if (fallbackProjectId) {
      handleSelectProject(fallbackProjectId);
    }
  }, [
    handleSelectProject,
    projects,
    selectedProjectId,
    setSelectedProjectIds,
    userId,
  ]);

  return {
    selectedProjectId,
    selectedProject,
    onSelectProject: handleSelectProject,
  };
}
