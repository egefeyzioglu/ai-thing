"use client";

import posthog from 'posthog-js';
import {PostHogProvider as PHProvider} from '@posthog/react';
import { useUser } from "@clerk/nextjs";
import type React from "react";
import { useEffect } from "react";
import { env } from "src/env";
import { recordBrowserEvent } from "src/lib/observability/browser";

if (typeof window !== "undefined" && !posthog.__loaded) {
  posthog.init(env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN, {
    api_host: env.NEXT_PUBLIC_POSTHOG_API_HOST,
    ui_host: env.NEXT_PUBLIC_POSTHOG_UI_HOST,
    defaults: "2026-01-30",
    person_profiles: "identified_only",
    capture_exceptions: true,
  });
}

function PostHogIdentifier() {
  const { user, isLoaded } = useUser();

  useEffect(() => {
    if (!isLoaded) return;
    if (user) {
      posthog.identify(user.id, {
        email: user.primaryEmailAddress?.emailAddress,
        name: user.fullName,
      });
    } else {
      posthog.reset();
    }
  }, [isLoaded, user]);

  return null;
}

function BrowserObservability() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      recordBrowserEvent("browser.javascript.error", {
        attributes: {
          errorName: event.error instanceof Error ? event.error.name : "Error",
        },
        outcome: "unexpected_error",
      });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      recordBrowserEvent("browser.promise.unhandled_rejection", {
        attributes: {
          errorName:
            event.reason instanceof Error ? event.reason.name : "UnknownError",
        },
        outcome: "unexpected_error",
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}

export function PostHogProvider({children}: {children: React.ReactNode}) {
  return (
    <PHProvider client={posthog}>
      <PostHogIdentifier />
      <BrowserObservability />
      {children}
    </PHProvider>
  );
}
