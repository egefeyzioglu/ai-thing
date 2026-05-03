import "src/styles/globals.css";

import { type Metadata } from "next";
import { Geist } from "next/font/google";

import { ClerkProvider } from "@clerk/nextjs";

import { TooltipProvider } from "src/components/ui/tooltip";
import { TRPCReactProvider } from "src/trpc/react";

import { PostHogProvider } from "./providers";

export const metadata: Metadata = {
  title: "AI Thing",
  description: "",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
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
      <body>
        <ClerkProvider>
          <PostHogProvider>
            <TooltipProvider>
              <TRPCReactProvider>{children}</TRPCReactProvider>
            </TooltipProvider>
          </PostHogProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
