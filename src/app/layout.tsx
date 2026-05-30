import "src/styles/globals.css";

import { type Metadata } from "next";
import { Geist } from "next/font/google";

import { ClerkProvider } from "@clerk/nextjs";

import { TooltipProvider } from "src/components/ui/tooltip";
import { Toaster } from "src/components/ui/sonner";
import { TRPCReactProvider } from "src/trpc/react";

import { DeploymentRefreshNotifier } from "./_components/deployment-refresh-notifier";
import { PostHogProvider } from "./providers";

export const metadata: Metadata = {
  title: "AI Thing",
  description: "",
  icons: [
      { rel: "icon", sizes: "32x32", url: "/favicon_32x32.ico" },
      { rel: "icon", sizes: "32x32", type:"image/webp", url: "/favicon_32x32.webp" },
  ],
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable}`}>
      <body className="bg-background min-h-screen w-screen flex flex-col">
        <ClerkProvider>
          <PostHogProvider>
            <TooltipProvider>
              <TRPCReactProvider>{children}</TRPCReactProvider>
              <DeploymentRefreshNotifier />
              <Toaster />
            </TooltipProvider>
          </PostHogProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
