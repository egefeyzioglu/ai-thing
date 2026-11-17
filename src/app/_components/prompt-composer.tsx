"use client";

import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type Ref,
} from "react";
import { MessagesSquare } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "src/components/ui/button";
import { Field, FieldLabel } from "src/components/ui/field";
import { Textarea } from "src/components/ui/textarea";
import { isWorkshopEnabled } from "src/lib/feature-flags";
import { useSessionStorage } from "src/lib/sessionStorage";
import { WORKSHOP_DRAFT_STORAGE_KEY } from "src/lib/workshop";

type HasContentListener = (hasContent: boolean) => void;
type TextChangeListener = (value: string) => void;

export type PromptComposerHandle = {
  getValue: () => string;
  setValue: (value: string) => void;
  focus: () => void;
  getHasContent: () => boolean;
  subscribeHasContent: (listener: HasContentListener) => () => void;
  subscribeTextChange: (listener: TextChangeListener) => () => void;
};

type PromptComposerProps = {
  ref?: Ref<PromptComposerHandle>;
  isMacOS: boolean | null;
  onSubmit: () => void;
};

export const PromptComposer = memo(function PromptComposer({
  ref,
  isMacOS,
  onSubmit,
}: PromptComposerProps) {
  const [promptText, setPromptText] = useSessionStorage("promptText");

  const valueRef = useRef("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  valueRef.current = promptText;

  const hasContentRef = useRef(false);
  const hasContentListenersRef = useRef(new Set<HasContentListener>());
  const textChangeListenersRef = useRef(new Set<TextChangeListener>());

  const notifyHasContent = useCallback((value: string) => {
    const hasContent = value.trim().length > 0;
    if (hasContent === hasContentRef.current) return;
    hasContentRef.current = hasContent;
    hasContentListenersRef.current.forEach((listener) => listener(hasContent));
  }, []);

  const notifyTextChange = useCallback((value: string) => {
    textChangeListenersRef.current.forEach((listener) => listener(value));
  }, []);

  useEffect(() => {
    notifyHasContent(promptText);
  }, [notifyHasContent, promptText]);

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
      focus: () => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
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
    [notifyHasContent, notifyTextChange, setPromptText],
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
    <Field className="gap-2">
      <FieldLabel
        htmlFor="prompt"
        className="text-muted-foreground text-xs font-medium"
      >
        Prompt
      </FieldLabel>
      <Textarea
        id="prompt"
        ref={textareaRef}
        placeholder="Describe what you want to create…"
        value={promptText}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className="max-h-72 min-h-28 resize-none text-sm leading-relaxed"
      />
      {isWorkshopEnabled && <WorkshopLink getValue={getValue} />}
    </Field>
  );
});

type WorkshopLinkProps = {
  getValue: () => string;
};

const WorkshopLink = memo(function WorkshopLink({
  getValue,
}: WorkshopLinkProps) {
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
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-fit cursor-pointer"
      onClick={handleOpenWorkshop}
    >
      <MessagesSquare />
      Workshop
    </Button>
  );
});
