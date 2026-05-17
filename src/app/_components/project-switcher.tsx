"use client";

import { Check, ChevronsUpDown, Pencil, Plus } from "lucide-react";
import type { FormEvent, MouseEvent, PointerEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "src/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "src/components/ui/dialog";
import { Button } from "src/components/ui/button";
import { Input } from "src/components/ui/input";
import { Label } from "src/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "src/components/ui/popover";
import { Skeleton } from "src/components/ui/skeleton";
import { cn } from "src/lib/utils";
import type { Project } from "src/server/db/schema";
import { api } from "src/trpc/react";

type ProjectSwitcherProps = {
  projects: Project[] | undefined;
  selectedProject: Project | undefined;
  selectedProjectId: string | null;
  isLoading: boolean;
  onSelectProject: (projectId: string) => void;
};

function projectErrorMessage(error: {
  data?: { code?: string } | null;
  message?: string;
}) {
  if (error.data?.code === "CONFLICT") {
    return "A project with that name already exists";
  }

  return error.message ?? "Project update failed";
}

export function ProjectSwitcher({
  projects,
  selectedProject,
  selectedProjectId,
  isLoading,
  onSelectProject,
}: ProjectSwitcherProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [renameProjectId, setRenameProjectId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const utils = api.useUtils();

  const createProject = api.project.create.useMutation({
    onSuccess: (project) => {
      utils.project.list.setData(undefined, (old) =>
        old ? [...old, project] : [project],
      );
      void utils.project.list.invalidate();
      onSelectProject(project.id);
      setCreateOpen(false);
      setCreateName("");
      toast.success("Project created");
    },
    onError: (error) => {
      toast.error(projectErrorMessage(error));
    },
  });

  const renameProject = api.project.rename.useMutation({
    onSuccess: (project) => {
      utils.project.list.setData(undefined, (old) =>
        old?.map((existing) =>
          existing.id === project.id ? { ...existing, ...project } : existing,
        ),
      );
      void utils.project.list.invalidate();
      setRenameProjectId(null);
      toast.success("Project renamed");
    },
    onError: (error) => {
      toast.error(projectErrorMessage(error));
    },
  });

  const renamingProject =
    renameProjectId === null
      ? undefined
      : (projects ?? []).find((p) => p.id === renameProjectId);

  const trimmedCreateName = createName.trim();
  const canCreate = trimmedCreateName.length > 0 && !createProject.isPending;

  const trimmedRenameName = renameName.trim();
  const canRename =
    renamingProject !== undefined &&
    trimmedRenameName.length > 0 &&
    trimmedRenameName !== renamingProject.name &&
    !renameProject.isPending;

  const handleCreateSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canCreate) return;
    createProject.mutate({ name: trimmedCreateName });
  };

  const handleRenameSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canRename || !renamingProject) return;
    renameProject.mutate({
      id: renamingProject.id,
      name: trimmedRenameName,
    });
  };

  const handleRenameOpenChange = (open: boolean) => {
    if (!open) setRenameProjectId(null);
  };

  const handleCreateOpenChange = (open: boolean) => {
    setCreateOpen(open);
    if (!open) setCreateName("");
  };

  const openRenameFor = (
    event: MouseEvent | PointerEvent,
    project: Project,
  ) => {
    event.stopPropagation();
    event.preventDefault();
    setPopoverOpen(false);
    setRenameName(project.name);
    setRenameProjectId(project.id);
  };

  if (isLoading) {
    return <Skeleton className="h-8 w-64 rounded-lg" />;
  }

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              className="w-64 cursor-pointer justify-between"
              aria-label="Select project"
            />
          }
        >
          <span className="truncate">
            {selectedProject?.name ?? "Select project"}
          </span>
          <ChevronsUpDown className="opacity-60" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <Command>
            <CommandInput placeholder="Search projects..." />
            <CommandList>
              <CommandEmpty>No projects found.</CommandEmpty>
              <CommandGroup>
                {(projects ?? []).map((project) => (
                  <CommandItem
                    key={project.id}
                    value={project.name}
                    className="focus-within:bg-muted focus-within:text-foreground cursor-pointer"
                    onSelect={() => {
                      onSelectProject(project.id);
                      setPopoverOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        selectedProjectId === project.id
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    <button
                      type="button"
                      className="focus-visible:ring-ring/50 flex-1 cursor-pointer truncate rounded-sm px-1 text-left outline-none focus-visible:ring-3"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectProject(project.id);
                        setPopoverOpen(false);
                      }}
                    >
                      {project.name}
                    </button>
                    <div className="ml-auto flex items-center gap-2">
                      {project.isDefault && (
                        <span className="text-muted-foreground text-[10px] uppercase">
                          Default
                        </span>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground focus-visible:text-foreground cursor-pointer opacity-60 hover:opacity-100 focus-visible:opacity-100"
                        aria-label={`Edit ${project.name}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => openRenameFor(event, project)}
                      >
                        <Pencil />
                      </Button>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  value="__create-project__"
                  className="focus-within:bg-muted focus-within:text-foreground cursor-pointer"
                  onSelect={() => {
                    setPopoverOpen(false);
                    setCreateOpen(true);
                  }}
                >
                  <button
                    type="button"
                    className="focus-visible:ring-ring/50 flex flex-1 cursor-pointer items-center gap-2 rounded-sm px-1 text-left outline-none focus-visible:ring-3"
                    onClick={(event) => {
                      event.stopPropagation();
                      setPopoverOpen(false);
                      setCreateOpen(true);
                    }}
                  >
                    <Plus />
                    <span>New project</span>
                  </button>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Dialog open={createOpen} onOpenChange={handleCreateOpenChange}>
        <DialogContent>
          <form onSubmit={handleCreateSubmit} className="contents">
            <DialogHeader>
              <DialogTitle>Create project</DialogTitle>
              <DialogDescription>
                Create a project to organise your generations
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                maxLength={80}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="cursor-pointer"
                onClick={() => handleCreateOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="cursor-pointer"
                disabled={!canCreate}
              >
                {createProject.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renamingProject !== undefined}
        onOpenChange={handleRenameOpenChange}
      >
        <DialogContent>
          <form onSubmit={handleRenameSubmit} className="contents">
            <DialogHeader>
              <DialogTitle>Edit project name</DialogTitle>
              <DialogDescription>
                Rename {renamingProject?.name ?? "this project"}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="rename-project-name">Name</Label>
              <Input
                id="rename-project-name"
                value={renameName}
                onChange={(event) => setRenameName(event.target.value)}
                maxLength={80}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="cursor-pointer"
                onClick={() => setRenameProjectId(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="cursor-pointer"
                disabled={!canRename}
              >
                {renameProject.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
