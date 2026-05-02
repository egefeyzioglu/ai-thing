"use client";

import posthog from 'posthog-js';
import {PostHogProvider as PHProvider} from '@posthog/react';
import type React from "react";
import { useEffect } from "react";
import { env } from "src/env";

export function PostHogProvider({children}: {children: React.ReactNode}) {
  useEffect(()=>{
    console.log(posthog.init(env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN, {
      api_host: env.NEXT_PUBLIC_POSTHOG_HOST,
      defaults: '2026-01-30'
    }))
  }, []);

  return (
    <PHProvider client={posthog}>
        {children}
    </PHProvider>
  );
}