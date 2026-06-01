"use client";

import { useEffect, useRef } from "react";

import { api } from "src/trpc/react";

type VideoPollerProps = {
  mediaId: string;
  projectId: string;
};

const INITIAL_INTERVAL_MS = 8_000;
const BACKOFF_AFTER_MS = 60_000;
const BACKOFF_FACTOR = 1.5;
const MAX_INTERVAL_MS = 30_000;

/**
 * Drives one in-flight video media row's status by polling the Modelark
 * task on the server. Mount one per pending/running video (keyed by mediaId);
 * unmount when the row transitions to a terminal status.
 *
 * Updates the prompt.list cache via setData only when the row transitions to
 * a terminal status — intermediate polls don't touch the cache, so other
 * media in the gallery don't re-render.
 */
export function VideoPoller({ mediaId, projectId }: VideoPollerProps) {
  const utils = api.useUtils();
  const pollMutation = api.media.pollMediaGeneration.useMutation();

  const utilsRef = useRef(utils);
  utilsRef.current = utils;
  const pollMutationRef = useRef(pollMutation);
  pollMutationRef.current = pollMutation;

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    let currentInterval = INITIAL_INTERVAL_MS;

    const schedule = () => {
      if (cancelled) return;
      timeoutId = setTimeout(() => void tick(), currentInterval);
      if (Date.now() - startedAt > BACKOFF_AFTER_MS) {
        currentInterval = Math.min(
          currentInterval * BACKOFF_FACTOR,
          MAX_INTERVAL_MS,
        );
      }
    };

    const tick = async () => {
      if (cancelled) return;
      let result;
      try {
        result = await pollMutationRef.current.mutateAsync({ mediaId });
      } catch (err) {
        console.error(`[VideoPoller ${mediaId}] poll error:`, err);
        schedule();
        return;
      }
      if (cancelled) return;

      if (result.status !== "succeeded" && result.status !== "failed") {
        schedule();
        return;
      }

      utilsRef.current.prompt.list.setData({ projectId }, (prev) => {
        if (!prev) return prev;
        return prev.map((prompt) => {
          if (!prompt.media.some((m) => m.id === mediaId)) return prompt;
          return {
            ...prompt,
            media: prompt.media.map((m) =>
              m.id === mediaId ? { ...m, ...result } : m,
            ),
          };
        });
      });
    };

    schedule();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [mediaId, projectId]);

  return null;
}
