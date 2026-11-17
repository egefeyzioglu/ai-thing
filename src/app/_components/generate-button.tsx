"use client";

import {
  memo,
  useEffect,
  useId,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Loader2, Sparkles } from "lucide-react";

import { Button } from "src/components/ui/button";
import type { PromptComposerHandle } from "./prompt-composer";

type GenerateButtonProps = {
  promptComposerRef: RefObject<PromptComposerHandle | null>;
  selectedModelsCount: number;
  hasSelectedProject: boolean;
  isOverQuota: boolean;
  bypassMonthlyQuota: boolean;
  generateButtonLocked: boolean;
  isMacOS: boolean | null;
  onGenerate: () => void;
  /** What will be generated, shown above the button. */
  summary: ReactNode;
  /** What it will cost; stays visible even while generation is blocked. */
  cost: ReactNode;
};

export const GenerateButton = memo(function GenerateButton({
  promptComposerRef,
  selectedModelsCount,
  hasSelectedProject,
  isOverQuota,
  bypassMonthlyQuota,
  generateButtonLocked,
  isMacOS,
  onGenerate,
  summary,
  cost,
}: GenerateButtonProps) {
  const statusId = useId();
  const [hasContent, setHasContent] = useState(false);

  useEffect(() => {
    const composer = promptComposerRef.current;
    if (!composer) return;
    setHasContent(composer.getHasContent());
    return composer.subscribeHasContent(setHasContent);
  }, [promptComposerRef]);

  const blockedByQuota = isOverQuota && !bypassMonthlyQuota;
  const canGenerate =
    hasContent &&
    selectedModelsCount > 0 &&
    hasSelectedProject &&
    !blockedByQuota &&
    !generateButtonLocked;

  // Say why the button is disabled instead of leaving users to guess.
  const disabledReason = generateButtonLocked
    ? undefined
    : blockedByQuota
      ? "Out of monthly credits"
      : !hasContent
        ? "Write a prompt to generate"
        : selectedModelsCount === 0
          ? "Select at least one model"
          : !hasSelectedProject
            ? "Select a project"
            : undefined;

  return (
    <>
      <p
        id={statusId}
        aria-live="polite"
        className="text-muted-foreground flex min-h-4 items-center justify-between gap-2 text-xs tabular-nums"
      >
        {disabledReason ? (
          <span className="text-foreground/90">{disabledReason}</span>
        ) : (
          <span>{summary}</span>
        )}
        {cost}
      </p>
      <Button
        type="button"
        size="lg"
        aria-busy={generateButtonLocked}
        className="h-10 w-full text-sm"
        disabled={!canGenerate}
        aria-describedby={statusId}
        onClick={onGenerate}
      >
        {generateButtonLocked ? (
          <>
            <Loader2 className="animate-spin" />
            Starting…
          </>
        ) : blockedByQuota ? (
          "Out of credits"
        ) : (
          <>
            <Sparkles />
            Generate
            {isMacOS !== null && (
              <kbd className="bg-primary-foreground/15 ml-1 rounded px-1.5 py-px font-sans text-[11px] font-medium">
                {isMacOS ? "⌘" : "Ctrl"} ↵
              </kbd>
            )}
          </>
        )}
      </Button>
    </>
  );
});
