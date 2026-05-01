"use client";

import { UTUploadButton, UTUploadDropzone } from "src/lib/uploadthing";
import { api } from "src/trpc/react";

import ReferenceImage from "./reference-image";

type ReferenceGalleryProps = {
  selectedImages: string[];
  setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>;
};

export default function ReferenceGallery(props: ReferenceGalleryProps) {
  const utils = api.useUtils();
  const referenceImagesQuery = api.referenceImage.getReferenceImages.useQuery();
  const referenceImageMutation =
    api.referenceImage.createReferenceImage.useMutation();

  const { selectedImages, setSelectedImages } = props;

  const handleUploadComplete = async (res: { ufsUrl: string }[]) => {
    await Promise.all(
      res.map((file) =>
        referenceImageMutation.mutateAsync({ url: file.ufsUrl }),
      ),
    );
    await utils.referenceImage.invalidate().catch((reason) => {
      console.warn(
        "Error invalidating reference image query, user will have to refresh",
        reason,
      );
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <UTUploadDropzone
        endpoint="imageUploader"
        config={{ mode: "auto" }}
        appearance={{
          container: ({ isDragActive }) =>
            [
              "mt-0 min-h-24 w-full items-stretch justify-start rounded-md px-0 py-0 text-left transition",
              isDragActive
                ? "border border-dashed border-neutral-600 bg-neutral-900/70"
                : "border-0 bg-transparent",
            ].join(" "),
          uploadIcon: "hidden",
          label: "hidden",
          button: "hidden",
          allowedContent: "m-0 h-auto w-full text-inherit",
        }}
        content={{
          allowedContent: ({ isDragActive }) =>
            referenceImagesQuery.isLoading ? (
              <p className="text-sm text-neutral-500">Loading...</p>
            ) : referenceImagesQuery.isSuccess ? (
              referenceImagesQuery.data.length > 0 ? (
                <div className="grid w-full grid-cols-3 gap-1">
                  {referenceImagesQuery.data.map((row) => (
                    <ReferenceImage
                      url={row.url ?? ""}
                      key={row.id}
                      isSelected={selectedImages.includes(row.id)}
                      onSelect={() => {
                        if (selectedImages.includes(row.id)) {
                          setSelectedImages(
                            selectedImages.filter((item) => item !== row.id),
                          );
                        } else {
                          setSelectedImages([...selectedImages, row.id]);
                        }
                      }}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-neutral-500">
                  {isDragActive
                    ? "Drop files to upload."
                    : "No reference images yet."}
                </p>
              )
            ) : (
              <p className="text-sm text-red-400">
                Error fetching data {referenceImagesQuery.error?.message}
              </p>
            ),
        }}
        onClientUploadComplete={handleUploadComplete}
        onUploadError={(error: Error) => {
          alert(`ERROR! ${error.message}`);
        }}
      />

      <div className="flex flex-col items-center gap-1">
        <UTUploadButton
          endpoint="imageUploader"
          appearance={{ allowedContent: "hidden" }}
          onClientUploadComplete={handleUploadComplete}
          onUploadError={(error: Error) => {
            alert(`ERROR! ${error.message}`);
          }}
        />
        <p className="text-xs text-neutral-500">or drop files here</p>
      </div>
    </div>
  );
}
