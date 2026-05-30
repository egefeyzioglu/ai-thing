"use client";

import { RefreshCwIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const TOAST_ID = "deployment-refresh-available";

const loadedVersion = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;

type VersionResponse = {
  version?: string;
};

async function getLiveVersion() {
  const response = await fetch("/api/version", {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) return null;

  const data = (await response.json()) as VersionResponse;

  return data.version ?? null;
}

export function DeploymentRefreshNotifier() {
  const hasPromptedRef = useRef(false);

  useEffect(() => {
    if (!loadedVersion) return;

    let isCancelled = false;

    async function checkVersion() {
      if (hasPromptedRef.current) return;

      const liveVersion = await getLiveVersion().catch(() => null);

      if (
        isCancelled ||
        !liveVersion ||
        liveVersion === "unknown" ||
        liveVersion === loadedVersion
      ) {
        return;
      }

      hasPromptedRef.current = true;

      toast("A new version is available", {
        id: TOAST_ID,
        description: "Refresh the page to use the latest deployment.",
        duration: Infinity,
        dismissible: false,
        icon: <RefreshCwIcon className="size-4" />,
        action: {
          label: "Refresh",
          onClick: () => window.location.reload(),
        },
      });
    }

    void checkVersion();

    const intervalId = window.setInterval(() => {
      void checkVersion();
    }, CHECK_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkVersion();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return null;
}
