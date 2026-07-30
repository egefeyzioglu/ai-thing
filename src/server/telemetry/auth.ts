import "server-only";

import { currentUser } from "@clerk/nextjs/server";

export async function currentUserCanViewTelemetry(): Promise<boolean> {
  const user = await currentUser();
  return user?.publicMetadata.canViewTelemetry === true;
}
