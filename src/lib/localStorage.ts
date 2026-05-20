"use client";

import { z } from "zod";
import { useCallback, useEffect, useState } from "react";

type LocalStorageSchemaItem<TSchema extends z.ZodTypeAny> = {
  schema: TSchema;
  key: string;
  defaultValue: z.infer<TSchema>;
  version: number;
};

function defineLocalStorageItem<TSchema extends z.ZodTypeAny>(
  item: LocalStorageSchemaItem<TSchema>,
) {
  return item;
}

// version field currently unused
export const localStorageSchema = {
  activeProject: defineLocalStorageItem({
    schema: z.array(
      z.object({
        userId: z.string(),
        projectId: z.string(),
      }),
    ),
    key: "ai-thing.activeProjectByUser",
    defaultValue: [],
    version: 2,
  }),
  pinnedImages: defineLocalStorageItem({
    schema: z.array(
      z.object({
        imageId: z.string(),
        pinnedAt: z.number(),
      }),
    ),
    key: "ai-thing.pinnedImages",
    defaultValue: [],
    version: 1,
  }),
};

export type LocalStorageKey = keyof typeof localStorageSchema;
export type LocalStorageValue<K extends LocalStorageKey> = z.infer<
  (typeof localStorageSchema)[K]["schema"]
>;
type LocalStorageSetter<K extends LocalStorageKey> = (
  newVal:
    | LocalStorageValue<K>
    | ((prev: LocalStorageValue<K>) => LocalStorageValue<K>),
) => void;

export function getLocalStorage<K extends LocalStorageKey>(
  key: K,
): LocalStorageValue<K> | undefined {
  if (typeof window === "undefined") return undefined;

  const storageKey = localStorageSchema[key].key;
  const valueSchema = localStorageSchema[key].schema;

  const rawValue = localStorage.getItem(storageKey);
  if (rawValue === null) return undefined;

  try {
    // zod parse and JSON parse both throw
    return valueSchema.parse(JSON.parse(rawValue));
  } catch (err) {
    console.error(
      "Invalid local storage value shape. Resetting to default value",
      { key, err },
    );
    const defaultValue = localStorageSchema[key]
      .defaultValue as LocalStorageValue<K>;
    localStorage.setItem(storageKey, JSON.stringify(defaultValue));
    return defaultValue;
  }
}

export function setLocalStorage<K extends LocalStorageKey>(
  key: K,
  value: LocalStorageValue<K>,
) {
  if (typeof window === "undefined") return undefined;

  const storageKey = localStorageSchema[key].key;
  const valueSchema = localStorageSchema[key].schema;
  try {
    const valueToWrite = JSON.stringify(valueSchema.parse(value));
    localStorage.setItem(storageKey, valueToWrite);
  } catch (err) {
    console.error(
      "Invalid value shape or error with JSON.stringify. Did not save to local storage",
      { key, err },
    );
  }
}

export function useLocalStorage<K extends LocalStorageKey>(
  key: K,
): [LocalStorageValue<K>, LocalStorageSetter<K>] {
  const defaultValue = localStorageSchema[key].defaultValue;
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    const storedValue = getLocalStorage(key);
    if (storedValue !== undefined) {
      setValue(storedValue);
    }
  }, [key]);

  const setValueWrapper = useCallback(
    (
      newVal:
        | LocalStorageValue<K>
        | ((prev: LocalStorageValue<K>) => LocalStorageValue<K>),
    ) => {
      if (typeof newVal === "function") {
        setValue((prev: LocalStorageValue<K>) => {
          const newValue = newVal(
            prev ??
              (localStorageSchema[key].defaultValue),
          );
          setLocalStorage(key, newValue);
          return newValue;
        });
      } else {
        setLocalStorage(key, newVal);
        setValue(newVal);
      }
    },
    [key],
  );
  return [value, setValueWrapper];
}
