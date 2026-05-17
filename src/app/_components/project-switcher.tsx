"use client";

import { Check, ChevronsUpDown, Pencil, Plus } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
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
import { api } from "src/trpc/react";

type Project = {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

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
  const [renameOpen, setRenameOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [renameName, setRenameName] = useState("");
  const utils = api.useUtils();

  useEffect(() => {
    if (renameOpen) {
      setRenameName(selectedProject?.name ?? "");
    }
  }, [renameOpen, selectedProject?.name]);

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
      setRenameOpen(false);
      toast.success("Project renamed");
    },
    onError: (error) => {
      toast.error(projectErrorMessage(error));
    },
  });

  const trimmedCreateName = createName.trim();
  const trimmedRenameName = renameName.trim();
  const canCreate = trimmedCreateName.length > 0 && !createProject.isPending;
  const canRename =
    selectedProject !== undefined &&
    trimmedRenameName.length > 0 &&
    trimmedRenameName !== selectedProject.name &&
    !renameProject.isPending;

  const handleCreateSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canCreate) return;
    createProject.mutate({ name: trimmedCreateName });
  };

  const handleRenameSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canRename || !selectedProject) return;
    renameProject.mutate({ id: selectedProject.id, name: trimmedRenameName });
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-64 rounded-lg" />
        <Skeleton className="h-8 w-28 rounded-lg" />
        <Skeleton className="size-8 rounded-lg" />
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                className="w-64 justify-between"
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
                      <span className="truncate">{project.name}</span>
                      {project.isDefault && (
                        <span className="text-muted-foreground ml-auto text-[10px] uppercase">
                          Default
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <Button
          variant="outline"
          className="gap-1"
          onClick={() => setCreateOpen(true)}
        >
          <Plus />
          New Project
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Rename project"
          disabled={!selectedProject}
          onClick={() => setRenameOpen(true)}
        >
          <Pencil />
        </Button>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form onSubmit={handleCreateSubmit} className="contents">
            <DialogHeader>
              <DialogTitle>Create project</DialogTitle>
              <DialogDescription>
                Add a project to organize future generations.
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
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canCreate}>
                {createProject.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <form onSubmit={handleRenameSubmit} className="contents">
            <DialogHeader>
              <DialogTitle>Rename project</DialogTitle>
              <DialogDescription>
                Update the project name shown in the gallery.
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
                onClick={() => setRenameOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canRename}>
                {renameProject.isPending ? "Renaming..." : "Rename"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
