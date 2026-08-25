import { notFound } from "next/navigation";

import { currentUserCanViewTelemetry } from "src/server/telemetry/auth";

export default async function TelemetryLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (!(await currentUserCanViewTelemetry())) notFound();

  return children;
}
