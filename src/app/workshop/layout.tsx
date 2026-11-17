import { notFound } from "next/navigation";

import { isWorkshopEnabled } from "src/lib/feature-flags";

export default function WorkshopLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (!isWorkshopEnabled) notFound();
  return children;
}
