import { currentUser } from "@clerk/nextjs/server";

export async function currentUserCanBypassLimits(): Promise<boolean> {
  const user = await currentUser();
  return user?.publicMetadata.canBypassLimits === true;
}
