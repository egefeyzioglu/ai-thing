"use client";

import { useState } from "react";

import { Button } from "src/components/ui/button";

import {
  ASPECT_RATIOS,
  type AspectRatio,
  type GenerateOptions,
  MODEL_LABELS,
  MODELS,
  type ModelId,
  RESOLUTIONS,
  type Resolution,
} from "src/app/_components/models";

type SidebarProps = {
  onSubmit: (opts: GenerateOptions) => void | Promise<void>;
  onLogout: () => void | Promise<void>;
  errorMessage: string | null;
  setErrorMessage: (msg: string | null) => void;
};

const selectClass =
  "w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-neutral-600";

export function Sidebar({
  onSubmit,
  onLogout,
  errorMessage,
  setErrorMessage,
}: SidebarProps) {
  const [prompt, setPrompt] = useState("");
  const [selectedModels, setSelectedModels] = useState<Set<ModelId>>(
    () => new Set(MODELS),
  );
  const [resolution, setResolution] = useState<Resolution>("1024");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");

  const toggleModel = (model: ModelId) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
  };

  const handleSubmit = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    if (selectedModels.size === 0) {
      setErrorMessage("Select at least one model.");
      return;
    }
    setErrorMessage(null);
    await onSubmit({
      prompt: trimmed,
      models: new Set(selectedModels),
      resolution,
      aspectRatio,
    });
    setPrompt("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && e.ctrlKey) void handleSubmit();
  };

  return (
    <aside className="sticky top-0 flex h-screen w-80 shrink-0 flex-col gap-5 overflow-y-auto border-r border-neutral-800 bg-neutral-950 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">AI Thing</h1>
        <p className="text-xs text-neutral-500">
          Generate images side-by-side.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="prompt"
          className="text-xs font-medium uppercase tracking-wide text-neutral-400"
        >
          Prompt
        </label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe what you want to see…  (Ctrl+Enter to submit)"
          rows={5}
          className="w-full resize-y rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none transition placeholder:text-neutral-600 focus:border-neutral-600"
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          Models
        </legend>
        {MODELS.map((m) => (
          <label
            key={m}
            className="flex cursor-pointer items-center gap-2 text-sm text-neutral-200"
          >
            <input
              type="checkbox"
              checked={selectedModels.has(m)}
              onChange={() => toggleModel(m)}
              className="h-4 w-4 cursor-pointer accent-neutral-200"
            />
            <span>{MODEL_LABELS[m]}</span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="resolution"
          className="text-xs font-medium uppercase tracking-wide text-neutral-400"
        >
          Resolution
        </label>
        <select
          id="resolution"
          value={resolution}
          onChange={(e) => setResolution(e.target.value as Resolution)}
          className={selectClass}
        >
          {RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {r}px
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="aspect-ratio"
          className="text-xs font-medium uppercase tracking-wide text-neutral-400"
        >
          Aspect ratio
        </label>
        <select
          id="aspect-ratio"
          value={aspectRatio}
          onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
          className={selectClass}
        >
          {ASPECT_RATIOS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      <Button
        onClick={() => void handleSubmit()}
        disabled={prompt.trim().length === 0 || selectedModels.size === 0}
      >
        Generate
      </Button>

      {errorMessage ? (
        <p className="text-sm text-red-400">{errorMessage}</p>
      ) : null}

      <div className="mt-auto pt-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void onLogout()}
          className="w-full text-neutral-400 hover:text-neutral-100"
        >
          Sign out
        </Button>
      </div>
    </aside>
  );
}
