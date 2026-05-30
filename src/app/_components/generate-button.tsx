"use client";

import { useEffect, useState, type RefObject } from "react";
import clsx from "clsx";

import type { PromptComposerHandle } from "./prompt-composer";

type GenerateButtonProps = {
  promptComposerRef: RefObject<PromptComposerHandle | null>;
  selectedModelsCount: number;
  hasSelectedProject: boolean;
  isOverQuota: boolean;
  bypassMonthlyQuota: boolean;
  generateButtonLocked: boolean;
  onGenerate: () => void;
};

export function GenerateButton({
  promptComposerRef,
  selectedModelsCount,
  hasSelectedProject,
  isOverQuota,
  bypassMonthlyQuota,
  generateButtonLocked,
  onGenerate,
}: GenerateButtonProps) {
  const [hasContent, setHasContent] = useState(false);

  useEffect(() => {
    const composer = promptComposerRef.current;
    if (!composer) return;
    setHasContent(composer.getHasContent());
    return composer.subscribeHasContent(setHasContent);
  }, [promptComposerRef]);

  const canGenerate =
    hasContent &&
    selectedModelsCount > 0 &&
    hasSelectedProject &&
    (bypassMonthlyQuota || !isOverQuota) &&
    !generateButtonLocked;

  return (
    <button
      aria-busy={generateButtonLocked}
      className={clsx(
        "w-2/3 cursor-pointer rounded-md border border-1 px-4 py-2",
        canGenerate
          ? "hover:bg-gray-900 active:bg-gray-500"
          : "cursor-not-allowed opacity-50",
      )}
      disabled={!canGenerate}
      onClick={onGenerate}
    >
      {generateButtonLocked
        ? "Generating..."
        : isOverQuota && !bypassMonthlyQuota
          ? "Out of credits"
          : "Generate"}
    </button>
  );
}
