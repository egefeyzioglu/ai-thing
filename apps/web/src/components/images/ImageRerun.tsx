import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  ThreadId,
  type EnvironmentId,
  type ImageModelInfo,
  type ImageResolution,
  type ImageVersion,
} from "@t3tools/contracts";
import { Play } from "lucide-react";
import { useMemo, useState } from "react";

import { imagesEnvironment } from "~/state/images";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";

import { closestAspectRatio, useImageModels } from "./useImageAssetUrl";

const RESOLUTIONS: ReadonlyArray<ImageResolution> = ["1K", "2K", "4K"];
const isResolution = (value: string | undefined): value is ImageResolution =>
  value !== undefined && (RESOLUTIONS as ReadonlyArray<string>).includes(value);

function defaultModel(models: ReadonlyArray<ImageModelInfo>, preferred: string | undefined) {
  return (
    models.find((model) => model.id === preferred && model.available) ??
    models.find((model) => model.isDefault && model.available) ??
    models.find((model) => model.available) ??
    models[0]
  );
}

export interface ImageRerunProps {
  environmentId: EnvironmentId;
  cwd: string;
  threadId: string | null;
  path: string;
  /** The version whose prompt and settings seed the form. */
  version: ImageVersion | null;
  width: number | undefined;
  height: number | undefined;
}

/** Manual regeneration from the inspected version, no agent involved. Key it on the version so the form reseeds. */
export function ImageRerun({
  environmentId,
  cwd,
  threadId,
  path,
  version,
  width,
  height,
}: ImageRerunProps) {
  const models = useImageModels(environmentId, cwd);
  const list = useMemo(() => models.data?.models ?? [], [models.data]);
  const generate = useAtomCommand(imagesEnvironment.generate, {
    reportFailure: false,
  });

  const seedKey = version ? `${path}@${version.n}` : path;
  const [prompt, setPrompt] = useState(version?.source.prompt ?? "");
  const [modelId, setModelId] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<string | null>(null);
  const [resolution, setResolution] = useState<ImageResolution | null>(null);
  const [overwrite, setOverwrite] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const model = modelId
    ? list.find((entry) => entry.id === modelId)
    : defaultModel(list, version?.source.model);
  const aspectOptions = model?.aspectRatios ?? [];
  const effectiveAspect =
    aspectRatio && aspectOptions.includes(aspectRatio)
      ? aspectRatio
      : version?.source.aspectRatio && aspectOptions.includes(version.source.aspectRatio)
        ? version.source.aspectRatio
        : closestAspectRatio(aspectOptions, width ?? version?.width, height ?? version?.height);
  const resolutionOptions = model?.resolutions ?? [];
  const effectiveResolution =
    resolution && resolutionOptions.includes(resolution)
      ? resolution
      : isResolution(version?.source.resolution) &&
          resolutionOptions.includes(version.source.resolution)
        ? version.source.resolution
        : resolutionOptions[0];
  const costHint =
    model && effectiveResolution !== undefined
      ? model.estimatedCostUsd[effectiveResolution]
      : undefined;

  const run = async () => {
    if (!model || prompt.trim().length === 0 || running) return;
    setRunning(true);
    setError(null);
    setDone(null);
    const result = await generate({
      environmentId,
      input: {
        cwd,
        prompt: prompt.trim(),
        model: model.id,
        references: [seedKey],
        ...(threadId ? { threadId: ThreadId.make(threadId) } : {}),
        ...(effectiveAspect ? { aspectRatio: effectiveAspect } : {}),
        ...(effectiveResolution ? { resolution: effectiveResolution } : {}),
        ...(overwrite ? { output: path } : {}),
      },
    });
    setRunning(false);
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Generation failed.");
      return;
    }
    setDone(`${result.value.path}@${result.value.version.n}`);
  };

  return (
    <div className="flex flex-col gap-2.5 px-3 pb-3 text-xs">
      <Textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="Prompt"
        rows={4}
        aria-label="Prompt"
      />
      <div className="grid grid-cols-[72px_1fr] items-center gap-x-2 gap-y-2">
        <span className="text-muted-foreground">Model</span>
        {models.loading && list.length === 0 ? (
          <Spinner size="xs" tone="muted" />
        ) : (
          <Select
            value={model?.id ?? ""}
            onValueChange={(value) => {
              if (typeof value === "string") {
                setModelId(value);
                setAspectRatio(null);
                setResolution(null);
              }
            }}
          >
            <SelectTrigger size="compact" aria-label="Model">
              <SelectValue>{model ? model.id : "No model"}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {list.map((entry) => (
                <SelectItem key={entry.id} value={entry.id} disabled={!entry.available}>
                  <span className="flex flex-col">
                    <span>{entry.id}</span>
                    <span className="text-3xs text-muted-foreground">
                      {entry.available ? entry.provider : `Set ${entry.key}`}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        )}
        {model && !model.available ? (
          <>
            <span />
            <span className="text-2xs text-warning-foreground">Set {model.key} to enable.</span>
          </>
        ) : null}
        <span className="text-muted-foreground">Aspect</span>
        <Select
          value={effectiveAspect ?? ""}
          onValueChange={(value) => {
            if (typeof value === "string") setAspectRatio(value);
          }}
          disabled={aspectOptions.length === 0}
        >
          <SelectTrigger size="compact" aria-label="Aspect ratio">
            <SelectValue>{effectiveAspect ?? "—"}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {aspectOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <span className="text-muted-foreground">Resolution</span>
        <Select
          value={effectiveResolution ?? ""}
          onValueChange={(value) => {
            if (isResolution(typeof value === "string" ? value : undefined))
              setResolution(value as ImageResolution);
          }}
          disabled={resolutionOptions.length === 0}
        >
          <SelectTrigger size="compact" aria-label="Resolution">
            <SelectValue>{effectiveResolution ?? "—"}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {resolutionOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
                {model?.estimatedCostUsd[option] !== undefined
                  ? ` · ~$${model.estimatedCostUsd[option]?.toFixed(2)}`
                  : ""}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <label className="flex cursor-pointer items-center gap-2">
        <Checkbox
          checked={overwrite}
          onCheckedChange={(checked) => setOverwrite(checked === true)}
        />
        Overwrite this file as next version
      </label>
      <div className="flex items-center gap-2">
        <Button
          size="xs"
          disabled={!model || !model.available || prompt.trim().length === 0 || running}
          onClick={() => void run()}
        >
          {running ? <Spinner /> : <Play aria-hidden />}
          {running ? "Running…" : "Run"}
        </Button>
        {costHint !== undefined ? (
          <span className="text-2xs text-muted-foreground">~${costHint.toFixed(2)}</span>
        ) : null}
        {done ? (
          <span className="truncate font-mono text-2xs text-success-foreground">{done}</span>
        ) : null}
      </div>
      {error ? <p className="text-2xs text-destructive-foreground">{error}</p> : null}
    </div>
  );
}
