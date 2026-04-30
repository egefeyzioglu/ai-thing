"use client";

import Image from "next/image";
import { UTUploadButton } from "src/lib/uploadthing";
import { api } from "src/trpc/react";

export default function ReferenceGallery() {
  const utils = api.useUtils();
  const referenceImagesQuery = api.referenceImage.getReferenceImages.useQuery();
  const referenceImageMutation = api.referenceImage.createReferenceImage.useMutation({ onSuccess() { utils.referenceImage.invalidate() } });
  return (
    <div className="flex flex-col gap-5">
      {
        referenceImagesQuery.isLoading ?
          "Loading..." :
          referenceImagesQuery.isSuccess ?
            (
              referenceImagesQuery.data.length > 0 ?
                <div className="grid gap-1 w-full grid-cols-3">
                  {referenceImagesQuery.data.map((row) => (
                    <Image key={row.id} width={100} height={100} alt="Reference Image" src={row.url ?? ""} />
                  ))}
                </div>
                :
                "No reference images yet, try uploading one."
            ) :
            `Error fetching data ${referenceImagesQuery.error?.message}`
      }
      <UTUploadButton
        endpoint="imageUploader"
        onClientUploadComplete={(res) => {
          res.map((file) => { referenceImageMutation.mutate({ url: file.ufsUrl }) });
        }}
        onUploadError={(error: Error) => {
          // Do something with the error.
          alert(`ERROR! ${error.message}`);
        }}
      />
    </div>
  );
}