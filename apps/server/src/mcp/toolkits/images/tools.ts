import { ImageResolution } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ImageStore } from "../../../images/ImageStore.ts";

const dependencies = [McpInvocationContext.McpInvocationContext, ImageStore];

const PATH_HELP =
  "Project-relative (resolved against the project root, then this thread's image folder) or absolute. Append @N to address version N.";

const ImagePath = Schema.String.annotate({ description: PATH_HELP });
const ModelId = Schema.optional(
  Schema.String.annotate({
    description: "Model id from list_image_models. Defaults to gemini-2.5-flash-image.",
  }),
);
const Resolution = Schema.optional(
  ImageResolution.annotate({
    description:
      "1K, 2K or 4K; the model must support it. Defaults to 1K, or the model's lowest supported resolution when it has no 1K.",
  }),
);

/** Changes files on disk, but every write is a new version so nothing is lost. */
const writingTool = <T extends Tool.Any>(tool: T): T =>
  tool
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, false)
    .annotate(Tool.OpenWorld, true) as T;

const readonlyTool = <T extends Tool.Any>(tool: T): T =>
  tool
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false) as T;

export const ListImageModelsTool = readonlyTool(
  Tool.make("list_image_models", {
    description:
      "List the image generation models this server can use: provider, whether a key is configured, supported resolutions and aspect ratios, reference image support, and estimated cost per image. Also says where this thread's images are saved.",
    dependencies,
  }).annotate(Tool.Title, "List image models"),
);

export const GenerateImageTool = writingTool(
  Tool.make("generate_image", {
    description:
      "Generate an image from a prompt and save it as a versioned file in this thread's image folder. Returns the saved path and a preview; look at the preview and iterate with edit_image. Pass reference_images for style or content references, or output to save the result as the next version of an existing image.",
    parameters: Schema.Struct({
      prompt: Schema.String.annotate({
        description:
          "What to generate. Be concrete about subject, style, lighting and composition.",
      }),
      model: ModelId,
      aspect_ratio: Schema.optional(
        Schema.String.annotate({
          description:
            'Such as "1:1", "16:9", "3:2". Defaults to the first reference image\'s ratio, else 1:1.',
        }),
      ),
      resolution: Resolution,
      reference_images: Schema.optional(
        Schema.Array(ImagePath).annotate({
          description:
            "Images the model should look at. Each is recorded as a parent of the result.",
        }),
      ),
      output: Schema.optional(
        Schema.String.annotate({
          description:
            "Existing image to overwrite as its next version. Omit to create a new file.",
        }),
      ),
      filename: Schema.optional(
        Schema.String.annotate({
          description:
            "File name for a new file in the thread folder. Defaults to a slug of the prompt.",
        }),
      ),
    }),
    dependencies,
  }).annotate(Tool.Title, "Generate image"),
);

export const EditImageTool = writingTool(
  Tool.make("edit_image", {
    description:
      "Change an existing image with a prompt, keeping its aspect ratio. By default the result becomes the next version of the same path (the old bytes stay in history). Pass output to branch into another file, or variants to save several alternatives as sibling files next to the source. Every result is linked to the source version.",
    parameters: Schema.Struct({
      path: ImagePath,
      prompt: Schema.String.annotate({
        description: "The change to make. Say what should stay the same.",
      }),
      model: ModelId,
      resolution: Resolution,
      extra_references: Schema.optional(
        Schema.Array(ImagePath).annotate({
          description: "More reference images besides the source.",
        }),
      ),
      output: Schema.optional(
        Schema.String.annotate({
          description: "Save to this path instead of the source. Created when it does not exist.",
        }),
      ),
      variants: Schema.optional(
        Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 })).annotate({
          description:
            "1 to 8. More than one saves <stem>-alt1, -alt2, ... beside the source and never touches the source.",
        }),
      ),
    }),
    dependencies,
  }).annotate(Tool.Title, "Edit image"),
);

export const ImageHistoryTool = readonlyTool(
  Tool.make("image_history", {
    description:
      "Show every version of an image (prompt, model, size, when, rejected or not), what each was derived from, and related images in the same family. Returns a preview of the current version.",
    parameters: Schema.Struct({ path: ImagePath }),
    dependencies,
  }).annotate(Tool.Title, "Image history"),
);

export const RestoreImageVersionTool = writingTool(
  Tool.make("restore_image_version", {
    description:
      "Make an older version of an image current again. Appends a new version with the old bytes; nothing is deleted.",
    parameters: Schema.Struct({
      path: ImagePath,
      version: Schema.Int.annotate({ description: "Version number from image_history." }),
    }),
    dependencies,
  }).annotate(Tool.Title, "Restore image version"),
);

export const ViewImageTool = readonlyTool(
  Tool.make("view_image", {
    description:
      "Look at any image file: a project image, a specific version (path@N), or an absolute path such as a user attachment.",
    parameters: Schema.Struct({
      path: ImagePath,
      max_side: Schema.optional(
        Schema.Int.check(Schema.isBetween({ minimum: 64, maximum: 2048 })).annotate({
          description: "Longest side of the preview in pixels, 64 to 2048. Defaults to 1024.",
        }),
      ),
    }),
    dependencies,
  }).annotate(Tool.Title, "View image"),
);

export const IMAGE_TOOLS = [
  ListImageModelsTool,
  GenerateImageTool,
  EditImageTool,
  ImageHistoryTool,
  RestoreImageVersionTool,
  ViewImageTool,
] as const;

export type ListImageModelsInput = Tool.Parameters<typeof ListImageModelsTool>;
export type GenerateImageInput = Tool.Parameters<typeof GenerateImageTool>;
export type EditImageInput = Tool.Parameters<typeof EditImageTool>;
export type ImageHistoryInput = Tool.Parameters<typeof ImageHistoryTool>;
export type RestoreImageVersionInput = Tool.Parameters<typeof RestoreImageVersionTool>;
export type ViewImageInput = Tool.Parameters<typeof ViewImageTool>;

/** What every image tool hands the registration: text, image blocks, and a small structured summary. */
export interface ImagesToolOutput {
  readonly text: string;
  readonly images: ReadonlyArray<{ readonly data: string; readonly mimeType: string }>;
  readonly structured?: Record<string, unknown>;
}
