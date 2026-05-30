import { db } from "src/server/db";
import {
  generationCostEvents,
  type GenerationCostEvent,
  type GenerationCostEventOperation,
  type GenerationCostEventStatus,
} from "src/server/db/schema";

export const COST_PRICING_VERSION = "2026-05-22";

const TOKENS_PER_MILLION = 1_000_000;

const OPENAI_PRICING = {
  "gpt-5.4-mini": {
    textInputUsdMicrosPerMillion: 750_000,
    cachedTextInputUsdMicrosPerMillion: 75_000,
    textOutputUsdMicrosPerMillion: 4_500_000,
  },
  "gpt-5.4": {
    textInputUsdMicrosPerMillion: 2_500_000,
    cachedTextInputUsdMicrosPerMillion: 250_000,
    textOutputUsdMicrosPerMillion: 15_000_000,
  },
  "gpt-5.5": {
    textInputUsdMicrosPerMillion: 5_000_000,
    cachedTextInputUsdMicrosPerMillion: 500_000,
    textOutputUsdMicrosPerMillion: 30_000_000,
  },
  "gpt-image-2": {
    textInputUsdMicrosPerMillion: 5_000_000,
    cachedTextInputUsdMicrosPerMillion: 1_250_000,
    imageInputUsdMicrosPerMillion: 8_000_000,
    cachedImageInputUsdMicrosPerMillion: 2_000_000,
    imageOutputUsdMicrosPerMillion: 30_000_000,
  },
} as const;

const GEMINI_PRICING = {
  "gemini-3-flash-preview": {
    inputUsdMicrosPerMillion: 500_000,
    textOutputUsdMicrosPerMillion: 3_000_000,
  },
  "gemini-2.5-flash-image": {
    inputUsdMicrosPerMillion: 300_000,
    imageOutputUsdMicrosPerImage: 39_000,
    fallbackOutputTokensPerImage: 1290,
    fallbackOutputUsdMicrosPerMillion: 30_000_000,
  },
  "gemini-3.1-flash-image-preview": {
    inputUsdMicrosPerMillion: 500_000,
    textOutputUsdMicrosPerMillion: 3_000_000,
    imageOutputUsdMicrosPerMillion: 60_000_000,
  },
  "gemini-3-pro-image-preview": {
    inputUsdMicrosPerMillion: 2_000_000,
    textOutputUsdMicrosPerMillion: 12_000_000,
    imageOutputUsdMicrosPerMillion: 120_000_000,
  },
} as const;

type Provider = "openai" | "gemini";

type CostFields = {
  status: GenerationCostEventStatus;
  costUsdMicros: number;
  inputTextTokens?: number | null;
  inputImageTokens?: number | null;
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTextTokens?: number | null;
  outputImageTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  totalTokens?: number | null;
  outputImageCount?: number | null;
  fallbackReason?: string | null;
  costCalculationRaw: Record<string, unknown>;
};

type CostFallbackContext = {
  resolution?: string | null;
  aspectRatio?: string | null;
  outputImageCount?: number;
  size?: string | null;
  quality?: string | null;
  background?: string | null;
  negativePrompt?: string | null;
  seed?: string | null;
  thinking?: string | null;
};

function pricingContext(context: CostFallbackContext): Record<string, unknown> {
  return {
    resolution: context.resolution,
    outputImageCount: context.outputImageCount,
    size: context.size,
    quality: context.quality,
  };
}

type OpenAIResponseUsageRaw = {
  responseUsage?: unknown;
  imageGenerationCallUsage?: unknown;
};

type OpenAIResponseUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
    image_tokens?: number;
    text_tokens?: number;
  };
  output_tokens_details?: {
    image_tokens?: number;
    reasoning_tokens?: number;
  };
};

type OpenAIImagesUsage = {
  input_tokens?: number;
  input_tokens_details?: {
    image_tokens?: number;
    text_tokens?: number;
  };
  output_tokens?: number;
  total_tokens?: number;
};

type GeminiModalityTokenCount = {
  modality?: string;
  tokenCount?: number;
};

type GeminiUsageMetadata = {
  promptTokenCount?: number;
  cachedContentTokenCount?: number;
  candidatesTokenCount?: number;
  toolUsePromptTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
  promptTokensDetails?: GeminiModalityTokenCount[];
  cacheTokensDetails?: GeminiModalityTokenCount[];
  candidatesTokensDetails?: GeminiModalityTokenCount[];
  toolUsePromptTokensDetails?: GeminiModalityTokenCount[];
  serviceTier?: string;
};

export function formatUsdMicros(value: number): string {
  if (value > 0 && value < 10_000) return "<$0.01";

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 1_000_000);
}

function microsForTokens(
  tokens: number | null | undefined,
  microsPerMillion: number,
): number {
  if (!tokens || tokens <= 0) return 0;
  return Math.ceil((tokens * microsPerMillion) / TOKENS_PER_MILLION);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizeOpenAIResponseUsage(value: unknown): OpenAIResponseUsage | null {
  if (!isRecord(value)) return null;

  const inputTokens = readNumber(value, "input_tokens");
  const outputTokens = readNumber(value, "output_tokens");
  const totalTokens = readNumber(value, "total_tokens");
  const inputDetails = isRecord(value.input_tokens_details)
    ? value.input_tokens_details
    : undefined;
  const outputDetails = isRecord(value.output_tokens_details)
    ? value.output_tokens_details
    : undefined;

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    input_tokens_details: {
      cached_tokens: inputDetails
        ? readNumber(inputDetails, "cached_tokens")
        : undefined,
      image_tokens: inputDetails
        ? readNumber(inputDetails, "image_tokens")
        : undefined,
      text_tokens: inputDetails ? readNumber(inputDetails, "text_tokens") : undefined,
    },
    output_tokens_details: {
      image_tokens: outputDetails
        ? readNumber(outputDetails, "image_tokens")
        : undefined,
      reasoning_tokens: outputDetails
        ? readNumber(outputDetails, "reasoning_tokens")
        : undefined,
    },
  };
}

function normalizeOpenAIImagesUsage(value: unknown): OpenAIImagesUsage | null {
  if (!isRecord(value)) return null;

  const inputDetails = isRecord(value.input_tokens_details)
    ? value.input_tokens_details
    : undefined;

  return {
    input_tokens: readNumber(value, "input_tokens"),
    input_tokens_details: {
      image_tokens: inputDetails
        ? readNumber(inputDetails, "image_tokens")
        : undefined,
      text_tokens: inputDetails
        ? readNumber(inputDetails, "text_tokens")
        : undefined,
    },
    output_tokens: readNumber(value, "output_tokens"),
    total_tokens: readNumber(value, "total_tokens"),
  };
}

function normalizeGeminiUsage(value: unknown): GeminiUsageMetadata | null {
  if (!isRecord(value)) return null;

  const readDetails = (key: string): GeminiModalityTokenCount[] | undefined => {
    const details = value[key];
    if (!Array.isArray(details)) return undefined;

    const normalized: GeminiModalityTokenCount[] = [];
    for (const detail of details) {
      if (!isRecord(detail)) continue;
      const modality = detail.modality;
      const tokenCount = detail.tokenCount;
      if (typeof modality !== "string" || typeof tokenCount !== "number") {
        continue;
      }
      normalized.push({ modality, tokenCount });
    }

    return normalized;
  };

  return {
    promptTokenCount: readNumber(value, "promptTokenCount"),
    cachedContentTokenCount: readNumber(value, "cachedContentTokenCount"),
    candidatesTokenCount: readNumber(value, "candidatesTokenCount"),
    toolUsePromptTokenCount: readNumber(value, "toolUsePromptTokenCount"),
    thoughtsTokenCount: readNumber(value, "thoughtsTokenCount"),
    totalTokenCount: readNumber(value, "totalTokenCount"),
    promptTokensDetails: readDetails("promptTokensDetails"),
    cacheTokensDetails: readDetails("cacheTokensDetails"),
    candidatesTokensDetails: readDetails("candidatesTokensDetails"),
    toolUsePromptTokensDetails: readDetails("toolUsePromptTokensDetails"),
    serviceTier:
      typeof value.serviceTier === "string" ? value.serviceTier : undefined,
  };
}

function parseSizePixels(size?: string | null): number | undefined {
  const [rawWidth, rawHeight] = size?.split("x") ?? [];
  const width = Number(rawWidth);
  const height = Number(rawHeight);

  if (
    Number.isFinite(width) &&
    width > 0 &&
    Number.isFinite(height) &&
    height > 0
  ) {
    return width * height;
  }

  return undefined;
}

function outputTokensForOpenAIImage2Fallback(args: {
  resolution?: string | null;
  size?: string | null;
  quality?: string | null;
}): number {
  const quality =
    args.quality && args.quality !== "auto" ? args.quality : "medium";
  const baseTokens =
    quality === "low"
      ? 200
      : quality === "high"
        ? 7034
        : 1767;
  const pixels = parseSizePixels(args.size);

  if (pixels) {
    return Math.max(1, Math.ceil(baseTokens * (pixels / (1024 * 1024))));
  }

  switch (args.resolution) {
    case "512":
      return Math.max(1, Math.ceil(baseTokens * 0.25));
    case "2K":
    case "2048":
      return baseTokens * 4;
    case "4K":
    case "4096":
      return baseTokens * 8;
    default:
      return baseTokens;
  }
}

function outputTokensForGeminiFlashPreview(resolution?: string | null): number {
  switch (resolution) {
    case "512":
      return 747;
    case "2K":
    case "2048":
      return 1680;
    case "4K":
    case "4096":
      return 2520;
    default:
      return 1120;
  }
}

function outputTokensForGeminiProPreview(resolution?: string | null): number {
  switch (resolution) {
    case "4K":
    case "4096":
      return 2000;
    default:
      return 1120;
  }
}

function parseResolutionPixels(resolution?: string | null): number {
  switch (resolution) {
    case "512":
      return 512;
    case "2K":
    case "2048":
      return 2048;
    case "4K":
    case "4096":
      return 4096;
    default:
      return 1024;
  }
}

function parseAspectRatio(aspectRatio?: string | null): {
  widthRatio: number;
  heightRatio: number;
} {
  const [rawWidth, rawHeight] = aspectRatio?.split(":") ?? [];
  const widthRatio = Number(rawWidth);
  const heightRatio = Number(rawHeight);

  if (
    Number.isFinite(widthRatio) &&
    widthRatio > 0 &&
    Number.isFinite(heightRatio) &&
    heightRatio > 0
  ) {
    return { widthRatio, heightRatio };
  }

  return { widthRatio: 1, heightRatio: 1 };
}

function outputTokensForGemini25Fallback(args: {
  resolution?: string | null;
  aspectRatio?: string | null;
}): number {
  const baseTokens = GEMINI_PRICING["gemini-2.5-flash-image"]
    .fallbackOutputTokensPerImage;
  const shortEdge = parseResolutionPixels(args.resolution);
  const { widthRatio, heightRatio } = parseAspectRatio(args.aspectRatio);
  const ratioScale = Math.max(widthRatio, heightRatio) /
    Math.min(widthRatio, heightRatio);
  const estimatedPixels = shortEdge * shortEdge * ratioScale;
  const basePixels = 1024 * 1024;
  const pixelScale = Math.max(1, estimatedPixels / basePixels);

  return Math.ceil(baseTokens * pixelScale);
}

function modalityTokens(
  details: GeminiModalityTokenCount[] | undefined,
  modality: "text" | "image",
): number | undefined {
  if (!details) return undefined;

  const total = details.reduce((sum, detail) => {
    return detail.modality?.toLowerCase() === modality
      ? sum + (detail.tokenCount ?? 0)
      : sum;
  }, 0);

  return total > 0 ? total : undefined;
}

function unsupportedModelCost(model: string): CostFields {
  return {
    status: "estimated",
    costUsdMicros: 0,
    fallbackReason: "unsupported_pricing_model",
    costCalculationRaw: {
      pricingVersion: COST_PRICING_VERSION,
      model,
      fallbackReason: "unsupported_pricing_model",
    },
  };
}

function calculateOpenAIResponseCost(args: {
  model: string;
  usageRaw: unknown;
}): CostFields {
  const pricing = OPENAI_PRICING[args.model as keyof typeof OPENAI_PRICING];
  if (!pricing || !("textOutputUsdMicrosPerMillion" in pricing)) {
    return unsupportedModelCost(args.model);
  }

  const raw = isRecord(args.usageRaw)
    ? (args.usageRaw as OpenAIResponseUsageRaw)
    : undefined;
  const usage = normalizeOpenAIResponseUsage(raw?.responseUsage);
  const imageToolUsage = normalizeOpenAIResponseUsage(
    raw?.imageGenerationCallUsage,
  );

  if (
    !usage?.input_tokens &&
    !usage?.output_tokens &&
    !imageToolUsage?.input_tokens &&
    !imageToolUsage?.output_tokens
  ) {
    return {
      status: "estimated",
      costUsdMicros: 0,
      fallbackReason: "missing_openai_responses_usage",
      costCalculationRaw: {
        pricingVersion: COST_PRICING_VERSION,
        provider: "openai",
        model: args.model,
        fallbackReason: "missing_openai_responses_usage",
      },
    };
  }

  const cachedInputTokens = usage?.input_tokens_details?.cached_tokens ?? 0;
  const imageToolCachedInputTokens =
    imageToolUsage?.input_tokens_details?.cached_tokens ?? 0;
  const billableInputTokens = Math.max(
    (usage?.input_tokens ?? 0) - cachedInputTokens,
    0,
  );
  const imageToolBillableInputTokens = Math.max(
    (imageToolUsage?.input_tokens ?? 0) - imageToolCachedInputTokens,
    0,
  );
  const inputCost = microsForTokens(
    billableInputTokens,
    pricing.textInputUsdMicrosPerMillion,
  );
  const cachedInputCost = microsForTokens(
    cachedInputTokens,
    pricing.cachedTextInputUsdMicrosPerMillion,
  );
  const outputCost = microsForTokens(
    usage?.output_tokens,
    pricing.textOutputUsdMicrosPerMillion,
  );
  const imageToolInputCost = microsForTokens(
    imageToolBillableInputTokens,
    pricing.textInputUsdMicrosPerMillion,
  );
  const imageToolCachedInputCost = microsForTokens(
    imageToolCachedInputTokens,
    pricing.cachedTextInputUsdMicrosPerMillion,
  );
  const imageToolOutputCost = microsForTokens(
    imageToolUsage?.output_tokens,
    pricing.textOutputUsdMicrosPerMillion,
  );

  return {
    status: "recorded",
    costUsdMicros:
      inputCost +
      cachedInputCost +
      outputCost +
      imageToolInputCost +
      imageToolCachedInputCost +
      imageToolOutputCost,
    inputImageTokens: imageToolUsage?.input_tokens_details?.image_tokens,
    inputTokens: (usage?.input_tokens ?? 0) + (imageToolUsage?.input_tokens ?? 0),
    cachedInputTokens: cachedInputTokens + imageToolCachedInputTokens,
    outputImageTokens:
      imageToolUsage?.output_tokens_details?.image_tokens ??
      imageToolUsage?.output_tokens,
    outputTokens:
      (usage?.output_tokens ?? 0) + (imageToolUsage?.output_tokens ?? 0),
    outputTextTokens: usage?.output_tokens,
    reasoningTokens:
      (usage?.output_tokens_details?.reasoning_tokens ?? 0) +
      (imageToolUsage?.output_tokens_details?.reasoning_tokens ?? 0),
    totalTokens:
      (usage?.total_tokens ?? 0) + (imageToolUsage?.total_tokens ?? 0),
    outputImageCount: imageToolUsage?.output_tokens ? 1 : undefined,
    costCalculationRaw: {
      pricingVersion: COST_PRICING_VERSION,
      provider: "openai",
      model: args.model,
      lineItems: {
        inputCost,
        cachedInputCost,
        outputCost,
        imageToolInputCost,
        imageToolCachedInputCost,
        imageToolOutputCost,
      },
    },
  };
}

function calculateGeminiTextCost(args: {
  model: string;
  usageRaw: unknown;
}): CostFields {
  if (args.model !== "gemini-3-flash-preview") {
    return unsupportedModelCost(args.model);
  }

  const usage = normalizeGeminiUsage(args.usageRaw);
  if (!usage) {
    return {
      status: "estimated",
      costUsdMicros: 0,
      fallbackReason: "missing_gemini_usage_metadata",
      costCalculationRaw: {
        pricingVersion: COST_PRICING_VERSION,
        provider: "gemini",
        model: args.model,
        fallbackReason: "missing_gemini_usage_metadata",
      },
    };
  }

  const pricing = GEMINI_PRICING["gemini-3-flash-preview"];
  const outputTextTokens = modalityTokens(
    usage.candidatesTokensDetails,
    "text",
  );
  const inputCost = microsForTokens(
    usage.promptTokenCount,
    pricing.inputUsdMicrosPerMillion,
  );
  const textOutputCost = microsForTokens(
    (outputTextTokens ?? usage.candidatesTokenCount ?? 0) +
      (usage.thoughtsTokenCount ?? 0),
    pricing.textOutputUsdMicrosPerMillion,
  );

  return {
    status: outputTextTokens === undefined ? "estimated" : "recorded",
    costUsdMicros: inputCost + textOutputCost,
    inputTextTokens: modalityTokens(usage.promptTokensDetails, "text"),
    inputTokens: usage.promptTokenCount,
    cachedInputTokens: usage.cachedContentTokenCount,
    outputTextTokens: outputTextTokens ?? usage.candidatesTokenCount,
    outputTokens: usage.candidatesTokenCount,
    reasoningTokens: usage.thoughtsTokenCount,
    totalTokens: usage.totalTokenCount,
    fallbackReason:
      outputTextTokens === undefined
        ? "candidates_token_count_charged_as_text_output_tokens"
        : null,
    costCalculationRaw: {
      pricingVersion: COST_PRICING_VERSION,
      provider: "gemini",
      model: args.model,
      serviceTier: usage.serviceTier,
      lineItems: { inputCost, textOutputCost },
    },
  };
}

function calculateOpenAIImagesCost(args: {
  model: string;
  operation: GenerationCostEventOperation;
  usageRaw: unknown;
  fallbackContext: CostFallbackContext;
}): CostFields {
  if (args.model !== "gpt-image-2") return unsupportedModelCost(args.model);

  const pricing = OPENAI_PRICING["gpt-image-2"];
  const usage = normalizeOpenAIImagesUsage(args.usageRaw);
  const assumptions: string[] = [];

  if (!usage?.input_tokens && !usage?.output_tokens) {
    const qualityFallbackAssumption =
      !args.fallbackContext.quality || args.fallbackContext.quality === "auto"
        ? ["auto_quality_charged_as_medium_for_missing_usage_fallback"]
        : [];
    const outputImageTokens = outputTokensForOpenAIImage2Fallback({
      resolution: args.fallbackContext.resolution,
      size: args.fallbackContext.size,
      quality: args.fallbackContext.quality,
    });
    const outputCost = microsForTokens(
      outputImageTokens,
      pricing.imageOutputUsdMicrosPerMillion,
    );

    return {
      status: "estimated",
      costUsdMicros: outputCost,
      outputImageTokens,
      outputTokens: outputImageTokens,
      outputImageCount: 1,
      fallbackReason: "missing_openai_images_usage",
      costCalculationRaw: {
        pricingVersion: COST_PRICING_VERSION,
        provider: "openai",
        model: args.model,
        fallbackReason: "missing_openai_images_usage",
        pricingContext: pricingContext(args.fallbackContext),
        assumptions: [
          "gpt_image_2_output_tokens_estimated_from_quality_and_size",
          ...qualityFallbackAssumption,
        ],
        lineItems: { outputCost },
      },
    };
  }

  let inputTextTokens = usage.input_tokens_details?.text_tokens;
  let inputImageTokens = usage.input_tokens_details?.image_tokens;

  if (
    usage.input_tokens !== undefined &&
    inputTextTokens === undefined &&
    inputImageTokens === undefined
  ) {
    if (args.operation === "image_edit") {
      inputImageTokens = usage.input_tokens;
      assumptions.push("input_tokens_charged_as_image_tokens_for_edit");
    } else {
      inputTextTokens = usage.input_tokens;
      assumptions.push("input_tokens_charged_as_text_tokens_for_generation");
    }
  }

  const textInputCost = microsForTokens(
    inputTextTokens,
    pricing.textInputUsdMicrosPerMillion,
  );
  const imageInputCost = microsForTokens(
    inputImageTokens,
    pricing.imageInputUsdMicrosPerMillion,
  );
  const imageOutputCost = microsForTokens(
    usage.output_tokens,
    pricing.imageOutputUsdMicrosPerMillion,
  );

  return {
    status: assumptions.length ? "estimated" : "recorded",
    costUsdMicros: textInputCost + imageInputCost + imageOutputCost,
    inputTextTokens,
    inputImageTokens,
    inputTokens: usage.input_tokens,
    outputImageTokens: usage.output_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    outputImageCount: 1,
    fallbackReason: assumptions.length ? assumptions.join(",") : null,
    costCalculationRaw: {
      pricingVersion: COST_PRICING_VERSION,
      provider: "openai",
      model: args.model,
      pricingContext: pricingContext(args.fallbackContext),
      assumptions,
      lineItems: { textInputCost, imageInputCost, imageOutputCost },
    },
  };
}

function calculateGeminiCost(args: {
  model: string;
  usageRaw: unknown;
  fallbackContext: CostFallbackContext;
  outputImageCount: number;
}): CostFields {
  const pricing = GEMINI_PRICING[args.model as keyof typeof GEMINI_PRICING];
  if (!pricing) return unsupportedModelCost(args.model);

  const usage = normalizeGeminiUsage(args.usageRaw);

  if (!usage) {
    if (args.model === "gemini-2.5-flash-image") {
      const outputImageTokens = outputTokensForGemini25Fallback({
        resolution: args.fallbackContext.resolution,
        aspectRatio: args.fallbackContext.aspectRatio,
      });
      const costUsdMicros =
        microsForTokens(
          outputImageTokens,
          GEMINI_PRICING["gemini-2.5-flash-image"]
            .fallbackOutputUsdMicrosPerMillion,
        ) * args.outputImageCount;
      return {
        status: "estimated",
        costUsdMicros,
        outputImageTokens,
        outputTokens: outputImageTokens,
        outputImageCount: args.outputImageCount,
        fallbackReason: "missing_gemini_usage_metadata",
        costCalculationRaw: {
          pricingVersion: COST_PRICING_VERSION,
          provider: "gemini",
          model: args.model,
          fallbackReason: "missing_gemini_usage_metadata",
          pricingContext: pricingContext(args.fallbackContext),
          assumptions: [
            "scaled_from_1290_tokens_for_1k_square_or_smaller_by_estimated_pixel_area",
          ],
          lineItems: { imageOutputCost: costUsdMicros },
        },
      };
    }

    const outputImageTokens =
      args.model === "gemini-3-pro-image-preview"
        ? outputTokensForGeminiProPreview(args.fallbackContext.resolution)
        : outputTokensForGeminiFlashPreview(args.fallbackContext.resolution);
    const imageOutputUsdMicrosPerMillion =
      args.model === "gemini-3-pro-image-preview"
        ? GEMINI_PRICING["gemini-3-pro-image-preview"]
            .imageOutputUsdMicrosPerMillion
        : GEMINI_PRICING["gemini-3.1-flash-image-preview"]
            .imageOutputUsdMicrosPerMillion;
    const imageOutputCost = microsForTokens(
      outputImageTokens,
      imageOutputUsdMicrosPerMillion,
    );

    return {
      status: "estimated",
      costUsdMicros: imageOutputCost,
      outputImageTokens,
      outputTokens: outputImageTokens,
      outputImageCount: args.outputImageCount,
      fallbackReason: "missing_gemini_usage_metadata",
      costCalculationRaw: {
        pricingVersion: COST_PRICING_VERSION,
        provider: "gemini",
        model: args.model,
        fallbackReason: "missing_gemini_usage_metadata",
        pricingContext: pricingContext(args.fallbackContext),
        lineItems: { imageOutputCost },
      },
    };
  }

  const inputTextTokens = modalityTokens(usage.promptTokensDetails, "text");
  const inputImageTokens = modalityTokens(usage.promptTokensDetails, "image");
  const outputTextTokens = modalityTokens(
    usage.candidatesTokensDetails,
    "text",
  );
  let outputImageTokens = modalityTokens(
    usage.candidatesTokensDetails,
    "image",
  );
  const assumptions: string[] = [];

  if (
    outputImageTokens === undefined &&
    usage.candidatesTokenCount !== undefined
  ) {
    outputImageTokens = usage.candidatesTokenCount;
    assumptions.push("candidates_token_count_charged_as_image_output_tokens");
  }

  const inputCost = microsForTokens(
    usage.promptTokenCount,
    pricing.inputUsdMicrosPerMillion,
  );

  let imageOutputCost = 0;
  let textOutputCost = 0;

  if (args.model === "gemini-2.5-flash-image") {
    imageOutputCost =
      GEMINI_PRICING["gemini-2.5-flash-image"]
        .imageOutputUsdMicrosPerImage * args.outputImageCount;
  } else if (args.model === "gemini-3-pro-image-preview") {
    imageOutputCost = microsForTokens(
      outputImageTokens,
      GEMINI_PRICING["gemini-3-pro-image-preview"]
        .imageOutputUsdMicrosPerMillion,
    );
    textOutputCost = microsForTokens(
      (outputTextTokens ?? 0) + (usage.thoughtsTokenCount ?? 0),
      GEMINI_PRICING["gemini-3-pro-image-preview"]
        .textOutputUsdMicrosPerMillion,
    );
  } else {
    imageOutputCost = microsForTokens(
      outputImageTokens,
      GEMINI_PRICING["gemini-3.1-flash-image-preview"]
        .imageOutputUsdMicrosPerMillion,
    );
    textOutputCost = microsForTokens(
      (outputTextTokens ?? 0) + (usage.thoughtsTokenCount ?? 0),
      GEMINI_PRICING["gemini-3.1-flash-image-preview"]
        .textOutputUsdMicrosPerMillion,
    );
  }

  return {
    status: assumptions.length ? "estimated" : "recorded",
    costUsdMicros: inputCost + imageOutputCost + textOutputCost,
    inputTextTokens,
    inputImageTokens,
    inputTokens: usage.promptTokenCount,
    cachedInputTokens: usage.cachedContentTokenCount,
    outputTextTokens,
    outputImageTokens,
    outputTokens: usage.candidatesTokenCount,
    reasoningTokens: usage.thoughtsTokenCount,
    totalTokens: usage.totalTokenCount,
    outputImageCount: args.outputImageCount,
    fallbackReason: assumptions.length ? assumptions.join(",") : null,
    costCalculationRaw: {
      pricingVersion: COST_PRICING_VERSION,
      provider: "gemini",
      model: args.model,
      serviceTier: usage.serviceTier,
      pricingContext: pricingContext(args.fallbackContext),
      assumptions,
      lineItems: { inputCost, imageOutputCost, textOutputCost },
    },
  };
}

function calculateCost(args: {
  provider: Provider;
  model: string;
  operation: GenerationCostEventOperation;
  usageRaw: unknown;
  fallbackContext: CostFallbackContext;
}): CostFields {
  if (args.provider === "openai") {
    if (
      args.operation === "responses_image_generation" ||
      args.model === "gpt-image-2"
    ) {
      const raw = isRecord(args.usageRaw)
        ? (args.usageRaw as OpenAIResponseUsageRaw)
        : undefined;
      return calculateOpenAIImagesCost({
        model: args.model,
        operation: args.operation,
        usageRaw: raw?.imageGenerationCallUsage ?? args.usageRaw,
        fallbackContext: args.fallbackContext,
      });
    }

    if (args.operation === "workshop_message") {
      return calculateOpenAIResponseCost({
        model: args.model,
        usageRaw: args.usageRaw,
      });
    }

    return calculateOpenAIImagesCost({
      model: args.model,
      operation: args.operation,
      usageRaw: args.usageRaw,
      fallbackContext: args.fallbackContext,
    });
  }

  if (args.operation === "workshop_message") {
    return calculateGeminiTextCost({
      model: args.model,
      usageRaw: args.usageRaw,
    });
  }

  return calculateGeminiCost({
    model: args.model,
    usageRaw: args.usageRaw,
    fallbackContext: args.fallbackContext,
    outputImageCount: args.fallbackContext.outputImageCount ?? 1,
  });
}

export async function recordGenerationCostEvent(args: {
  userId: string;
  imageId?: string | null;
  usageId?: string | null;
  provider: Provider;
  model: string;
  providerModel?: string | null;
  operation: GenerationCostEventOperation;
  providerRequestId?: string | null;
  usageRaw: unknown;
  fallbackContext: CostFallbackContext;
}): Promise<GenerationCostEvent> {
  const cost = calculateCost(args);
  const [event] = await db
    .insert(generationCostEvents)
    .values({
      id: crypto.randomUUID(),
      userId: args.userId,
      imageId: args.imageId,
      usageId: args.usageId,
      provider: args.provider,
      providerRequestId: args.providerRequestId,
      model: args.model,
      providerModel: args.providerModel,
      operation: args.operation,
      status: cost.status,
      pricingVersion: COST_PRICING_VERSION,
      costUsdMicros: cost.costUsdMicros,
      inputTextTokens: cost.inputTextTokens,
      inputImageTokens: cost.inputImageTokens,
      inputTokens: cost.inputTokens,
      cachedInputTokens: cost.cachedInputTokens,
      outputTextTokens: cost.outputTextTokens,
      outputImageTokens: cost.outputImageTokens,
      outputTokens: cost.outputTokens,
      reasoningTokens: cost.reasoningTokens,
      totalTokens: cost.totalTokens,
      outputImageCount: cost.outputImageCount,
      fallbackReason: cost.fallbackReason,
      usageRaw: args.usageRaw,
      costCalculationRaw: cost.costCalculationRaw,
    })
    .returning();

  if (!event) {
    throw new Error("Failed to insert generation cost event");
  }

  return event;
}
