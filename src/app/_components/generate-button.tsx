"use client";

import { useEffect, useState, type RefObject } from "react";

import { Button } from "src/components/ui/button";
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
    <Button
      type="button"
      variant="outline"
      aria-busy={generateButtonLocked}
      className="h-auto w-2/3 rounded-md px-4 py-2 hover:bg-gray-900 active:bg-gray-500"
      disabled={!canGenerate}
      onClick={onGenerate}
    >
      {generateButtonLocked
        ? "Generating..."
        : isOverQuota && !bypassMonthlyQuota
          ? "Out of credits"
          : "Generate"}
    </Button>
  );
}
