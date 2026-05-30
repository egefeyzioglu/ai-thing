"use client";

import { useImperativeHandle, useRef, useState, type Ref } from "react";
import clsx from "clsx";
import { MessagesSquare } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "src/components/ui/button";
import { Field, FieldLabel } from "src/components/ui/field";
import { Textarea } from "src/components/ui/textarea";
import { WORKSHOP_DRAFT_STORAGE_KEY } from "src/lib/workshop";

export type PromptComposerHandle = {
  getValue: () => string;
  setValue: (value: string) => void;
};

type PromptComposerProps = {
  ref?: Ref<PromptComposerHandle>;
  isMacOS: boolean | null;
  onSubmit: () => void;
  onHasContentChange: (hasContent: boolean) => void;
};

export function PromptComposer({
  ref,
  isMacOS,
  onSubmit,
  onHasContentChange,
}: PromptComposerProps) {
  const [promptText, setPromptText] = useState("");
  const router = useRouter();

  const valueRef = useRef("");
  valueRef.current = promptText;

  const lastHasContentRef = useRef(false);

  const notifyHasContent = (value: string) => {
    const hasContent = value.trim().length > 0;
    if (hasContent !== lastHasContentRef.current) {
      lastHasContentRef.current = hasContent;
      onHasContentChange(hasContent);
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      getValue: () => valueRef.current,
      setValue: (value: string) => {
        setPromptText(value);
        valueRef.current = value;
        notifyHasContent(value);
      },
    }),
    // notifyHasContent reads refs/props directly, so the handle identity can be stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setPromptText(next);
    notifyHasContent(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (
      (isMacOS && e.metaKey && e.key === "Enter") ||
      (!isMacOS && e.ctrlKey && e.key === "Enter")
    ) {
      e.preventDefault();
      onSubmit();
    }
  };

  const handleOpenWorkshop = () => {
    const trimmedPrompt = promptText.trim();
    if (trimmedPrompt) {
      try {
        sessionStorage.setItem(WORKSHOP_DRAFT_STORAGE_KEY, promptText);
      } catch (error) {
        console.error("Failed to save workshop draft", error);
      }
    }

    router.push("/workshop/");
  };

  return (
    <Field>
      <FieldLabel className="text-xxs text-(--muted-foreground) uppercase">
        Prompt
      </FieldLabel>
      <Textarea
        id="prompt"
        placeholder="What do you want to create?.."
        value={promptText}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      <div className="flex items-center justify-between gap-2">
        <span
          className={clsx(
            "mx-0 text-xs text-(--muted-foreground)",
            isMacOS === null ? "opacity-0" : "opacity-80",
          )}
        >
          Press {isMacOS ? "⌘" : "Ctrl"} + Enter to submit
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="cursor-pointer"
          onClick={handleOpenWorkshop}
        >
          <MessagesSquare />
          Workshop
        </Button>
      </div>
    </Field>
  );
}
