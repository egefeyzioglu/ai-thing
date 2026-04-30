import "src/styles/globals.css";

import { type Metadata } from "next";
import { Geist } from "next/font/google";

import { ClerkProvider } from "@clerk/nextjs"

import { TRPCReactProvider } from "src/trpc/react";

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
          <TRPCReactProvider>{children}</TRPCReactProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
