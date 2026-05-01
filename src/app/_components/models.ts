export const MODELS = ["gpt-5.4-mini", "gemini-2.5-flash-image"] as const;
export type ModelId = (typeof MODELS)[number];

export const MODEL_LABELS: Record<ModelId, string> = {
  "gpt-5.4-mini": "GPT 5.4 Mini",
  "gemini-2.5-flash-image": "Nano Banana (gemini-2.5-flash-image)",
};

export const RESOLUTIONS = ["512", "1024", "2048"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export const ASPECT_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export function modelLabel(model: string): string {
  return MODEL_LABELS[model as ModelId] ?? model;
}

export type GenerateOptions = {
  prompt: string;
  models: Set<ModelId>;
  resolution: Resolution;
  aspectRatio: AspectRatio;
  referenceImages?: string[];
};
