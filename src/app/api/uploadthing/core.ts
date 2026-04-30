import { createUploadthing, UploadThingError, type FileRouter } from "uploadthing/server";
import { auth } from "@clerk/nextjs/server";

const f = createUploadthing();

export const fileRouter = {
    imageUploader: f({
        image: {
            maxFileSize: "4MB",
            maxFileCount: 1,
        },
    }).middleware(async () => {
        const user = await auth();
        if(!user.isAuthenticated) throw new UploadThingError("UNAUTHORIZED");
        return {userId: user.userId};
    }).onUploadComplete(async ({metadata, file}) => {
        console.log(`Upload complete for ${metadata.userId} at ${file.ufsUrl}`);
        return {uploadedBy: metadata.userId};
    })
} satisfies FileRouter;

export type UTFileRouter = typeof fileRouter;
