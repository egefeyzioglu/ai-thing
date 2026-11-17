import { env } from "src/env";

/**
 * The prompt workshop has been replaced by the desktop app. It stays in the
 * codebase behind this flag, which is off unless explicitly enabled.
 */
export const isWorkshopEnabled = env.NEXT_PUBLIC_ENABLE_WORKSHOP === "true";
