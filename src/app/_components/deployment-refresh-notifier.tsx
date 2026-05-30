"use client";

import { RefreshCwIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

const CHECK_INTERVAL_MS = 60 * 1000;
const TOAST_ID = "deployment-refresh-available";

const loadedVersion = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;

type VersionResponse = {
  forceRefreshNotify?: boolean;
  version?: string;
};

async function getLiveDeploymentState() {
  const response = await fetch("/api/version", {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) return null;

  return (await response.json()) as VersionResponse;
}

export function DeploymentRefreshNotifier() {
  const hasPromptedRef = useRef(false);

  useEffect(() => {
    let isCancelled = false;

    async function checkVersion() {
      const liveState = await getLiveDeploymentState().catch(() => null);

      if (isCancelled || !liveState) return;

      if (liveState.forceRefreshNotify) {
        showRefreshToastOnce();
        return;
      }

      if (!loadedVersion) return;

      const liveVersion = liveState.version;

      if (
        !liveVersion ||
        liveVersion === "unknown" ||
        liveVersion === loadedVersion
      ) {
        return;
      }

      showRefreshToastOnce();
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

  function showRefreshToastOnce() {
    if (hasPromptedRef.current) return;

    hasPromptedRef.current = true;
    showRefreshToast();
  }

  return null;
}

function showRefreshToast() {
  const bounceHeightTimers: number[] = [];
  const clearBounceHeightTimers = () => {
    for (const timer of bounceHeightTimers) {
      window.clearTimeout(timer);
    }
  };

  toast("A new version is available", {
    id: TOAST_ID,
    className: "refresh-notify-toast",
    description: "Refresh the page to use the latest deployment.",
    duration: Infinity,
    dismissible: false,
    icon: <RefreshCwIcon className="size-4" />,
    action: {
      label: "Refresh",
      onClick: () => window.location.reload(),
    },
    onAutoClose: clearBounceHeightTimers,
    onDismiss: clearBounceHeightTimers,
  });

  bounceHeightTimers.push(
    window.setTimeout(() => {
      setToastBounceHeight("28px");
    }, 30 * 1000),
  );

  bounceHeightTimers.push(
    window.setTimeout(() => {
      setToastBounceHeight("280px");
    }, 60 * 1000),
  );

  bounceHeightTimers.push(
    window.setTimeout(() => {
      setToastBounceHeight("80vh");
    }, 10 * 60 * 1000),
  );
}

function setToastBounceHeight(height: string) {
  const toast = document.querySelector<HTMLElement>(".refresh-notify-toast");

  toast?.style.setProperty("--refresh-notify-bounce-height", height);
}
