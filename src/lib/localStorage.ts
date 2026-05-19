import { z } from "zod";

// version field currently unused
export const localStorageSchema = {
  activeProject: {
    schema: z.array(
      z.object({
        userId: z.string(),
        projectId: z.string(),
      })),
    key: "ai-thing.activeProjectByUser",
    defaultValue: [],
    version: 2,
  },
  pinnedImages: {
    schema: z.array(
      z.object({
        imageId: z.string(),
        pinnedAt: z.number(),
      }),
    ),
    key: "ai-thing.pinnedImages",
    defaultValue: [],
    version: 1,
  },
  pushPermissionPrompt: {
    schema: z.nullable(z.string()),
    key: "ai-thing.pushPermissionPrompt",
    defaultValue: null,
    version: 1,
  }
};

export type LocalStorageKey = keyof typeof localStorageSchema;
export type LocalStorageValue<K extends LocalStorageKey> = z.infer<typeof localStorageSchema[K]['schema']>;

export function getLocalStorage<K extends LocalStorageKey>(key: K): LocalStorageValue<K> | undefined {
  if (typeof window === "undefined") {
    console.warn("getLocalStorage called from the server, ignoring", { key });
    return;
  }

  const storageKey = localStorageSchema[key].key;
  const valueSchema = localStorageSchema[key].schema;

  const rawValue = localStorage.getItem(storageKey);
  if (rawValue === null) return undefined;

  try { // zod parse and JSON parse both throw
    return valueSchema.parse(JSON.parse(rawValue));
  } catch (err) {
    console.error("Invalid local storage value shape. Resetting to default value", { key, err });
    const defaultValue = localStorageSchema[key].defaultValue;
    localStorage.setItem(storageKey, JSON.stringify(defaultValue));
    return defaultValue;
  }
}

export function setLocalStorage<K extends LocalStorageKey>(key: K, value: LocalStorageValue<K>) {
  if (typeof window === "undefined") {
    console.warn("setLocalStorage called from the server, ignoring", { key, value });
    return;
  }

  const storageKey = localStorageSchema[key].key;
  const valueSchema = localStorageSchema[key].schema;
  try {
    const valueToWrite = JSON.stringify(valueSchema.parse(value));
    localStorage.setItem(storageKey, valueToWrite);
  } catch (err) {
    console.error("Invalid value shape or error with JSON.stringify. Did not save to local storage", {err})
  }
}
