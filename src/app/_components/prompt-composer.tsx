"use client";

import {
  memo,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import clsx from "clsx";
import { MessagesSquare } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "src/components/ui/button";
import { Field, FieldLabel } from "src/components/ui/field";
import { Textarea } from "src/components/ui/textarea";
import { WORKSHOP_DRAFT_STORAGE_KEY } from "src/lib/workshop";

type HasContentListener = (hasContent: boolean) => void;
type TextChangeListener = (value: string) => void;

export type PromptComposerHandle = {
  getValue: () => string;
  setValue: (value: string) => void;
  getHasContent: () => boolean;
  subscribeHasContent: (listener: HasContentListener) => () => void;
  subscribeTextChange: (listener: TextChangeListener) => () => void;
};

type PromptComposerProps = {
  ref?: Ref<PromptComposerHandle>;
  isMacOS: boolean | null;
  onSubmit: () => void;
};

export function PromptComposer({
  ref,
  isMacOS,
  onSubmit,
}: PromptComposerProps) {
  const [promptText, setPromptText] = useState("");

  const valueRef = useRef("");
  valueRef.current = promptText;

  const hasContentRef = useRef(false);
  const hasContentListenersRef = useRef(new Set<HasContentListener>());
  const textChangeListenersRef = useRef(new Set<TextChangeListener>());

  const notifyHasContent = (value: string) => {
    const hasContent = value.trim().length > 0;
    if (hasContent === hasContentRef.current) return;
    hasContentRef.current = hasContent;
    hasContentListenersRef.current.forEach((listener) => listener(hasContent));
  };

  const notifyTextChange = (value: string) => {
    textChangeListenersRef.current.forEach((listener) => listener(value));
  };

  useImperativeHandle(
    ref,
    () => ({
      getValue: () => valueRef.current,
      setValue: (value: string) => {
        setPromptText(value);
        valueRef.current = value;
        notifyHasContent(value);
        notifyTextChange(value);
      },
      getHasContent: () => hasContentRef.current,
      subscribeHasContent: (listener) => {
        hasContentListenersRef.current.add(listener);
        return () => {
          hasContentListenersRef.current.delete(listener);
        };
      },
      subscribeTextChange: (listener) => {
        textChangeListenersRef.current.add(listener);
        return () => {
          textChangeListenersRef.current.delete(listener);
        };
      },
    }),
    [],
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setPromptText(next);
    notifyHasContent(next);
    notifyTextChange(next);
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

  const getValue = useCallback(() => valueRef.current, []);

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
      <ComposerFooter isMacOS={isMacOS} getValue={getValue} />
    </Field>
  );
}

type ComposerFooterProps = {
  isMacOS: boolean | null;
  getValue: () => string;
};

const ComposerFooter = memo(function ComposerFooter({
  isMacOS,
  getValue,
}: ComposerFooterProps) {
  const router = useRouter();

  const handleOpenWorkshop = () => {
    const value = getValue();
    if (value.trim()) {
      try {
        sessionStorage.setItem(WORKSHOP_DRAFT_STORAGE_KEY, value);
      } catch (error) {
        console.error("Failed to save workshop draft", error);
      }
    }

    router.push("/workshop/");
  };

  return (
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
  );
});
