"use client";

import { z } from "zod";
import { useCallback, useEffect, useState } from "react";

type SessionStorageSchemaItem<TSchema extends z.ZodTypeAny> = {
  schema: TSchema;
  key: string;
  defaultValue: z.infer<TSchema>;
  version: number;
};

function defineSessionStorageItem<TSchema extends z.ZodTypeAny>(
  item: SessionStorageSchemaItem<TSchema>,
) {
  return item;
}

// version field currently unused
export const sessionStorageSchema = {
  imageGenerationAdvanced: defineSessionStorageItem({
    schema: z.object({
      quality: z.enum(["auto", "low", "medium", "high"]),
      background: z.enum(["auto", "opaque", "transparent"]),
      negativePrompt: z.string(),
      seed: z.string(),
      thinking: z.enum(["auto", "off", "low", "high"]),
      advancedOpen: z.boolean(),
    }),
    key: "ai-thing.imageGenerationAdvanced",
    defaultValue: {
      quality: "auto",
      background: "auto",
      negativePrompt: "",
      seed: "",
      thinking: "auto",
      advancedOpen: false,
    },
    version: 1,
  }),
};

export type SessionStorageKey = keyof typeof sessionStorageSchema;
export type SessionStorageValue<K extends SessionStorageKey> = z.infer<
  (typeof sessionStorageSchema)[K]["schema"]
>;
export type SessionStorageSetter<K extends SessionStorageKey> = (
  newVal:
    | SessionStorageValue<K>
    | ((prev: SessionStorageValue<K>) => SessionStorageValue<K>),
) => void;

export function getSessionStorage<K extends SessionStorageKey>(
  key: K,
): SessionStorageValue<K> | undefined {
  if (typeof window === "undefined") return undefined;

  const storageKey = sessionStorageSchema[key].key;
  const valueSchema = sessionStorageSchema[key].schema;

  let rawValue: string | null;
  try {
    rawValue = sessionStorage.getItem(storageKey);
  } catch (err) {
    console.error("Could not read from session storage", { key, err });
    return undefined;
  }
  if (rawValue === null) return undefined;

  try {
    return valueSchema.parse(JSON.parse(rawValue));
  } catch (err) {
    console.error(
      "Invalid session storage value shape. Resetting to default value",
      { key, err },
    );
    const defaultValue = sessionStorageSchema[key]
      .defaultValue as SessionStorageValue<K>;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(defaultValue));
    } catch (setErr) {
      console.error("Could not reset session storage to default value", {
        key,
        err: setErr,
      });
    }
    return defaultValue;
  }
}

export function setSessionStorage<K extends SessionStorageKey>(
  key: K,
  value: SessionStorageValue<K>,
) {
  if (typeof window === "undefined") return undefined;

  const storageKey = sessionStorageSchema[key].key;
  const valueSchema = sessionStorageSchema[key].schema;
  try {
    const valueToWrite = JSON.stringify(valueSchema.parse(value));
    sessionStorage.setItem(storageKey, valueToWrite);
  } catch (err) {
    console.error(
      "Invalid value shape or error with JSON.stringify. Did not save to session storage",
      { key, err },
    );
  }
}

export function useSessionStorage<K extends SessionStorageKey>(
  key: K,
): [SessionStorageValue<K>, SessionStorageSetter<K>] {
  const defaultValue = sessionStorageSchema[key].defaultValue;
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    const storedValue = getSessionStorage(key);
    if (storedValue !== undefined) {
      setValue(storedValue);
    }
  }, [key]);

  const setValueWrapper = useCallback(
    (
      newVal:
        | SessionStorageValue<K>
        | ((prev: SessionStorageValue<K>) => SessionStorageValue<K>),
    ) => {
      if (typeof newVal === "function") {
        setValue((prev: SessionStorageValue<K>) => {
          const newValue = newVal(prev ?? sessionStorageSchema[key].defaultValue);
          setSessionStorage(key, newValue);
          return newValue;
        });
      } else {
        setSessionStorage(key, newVal);
        setValue(newVal);
      }
    },
    [key],
  );
  return [value, setValueWrapper];
}
