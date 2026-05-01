"use client";

import { UTUploadButton } from "src/lib/uploadthing";
import { api } from "src/trpc/react";
import ReferenceImage from "./reference-image";

type ReferenceGalleryProps = {
  selectedImages: string[],
  setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>
}

export default function ReferenceGallery(props: ReferenceGalleryProps) {
  const utils = api.useUtils();
  const referenceImagesQuery = api.referenceImage.getReferenceImages.useQuery();
  const referenceImageMutation = api.referenceImage.createReferenceImage.useMutation({
    onSuccess() {
      utils.referenceImage.invalidate().catch(
        (reason) => { console.warn("Error invalidating reference image query, user will have to refresh", reason) }
      )
    }
  });

  const {selectedImages, setSelectedImages} = props;

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
                    <ReferenceImage url={row.url ?? ""} key={row.id}
                      isSelected={selectedImages.includes(row.id)}
                      onSelect={()=>{
                        if(selectedImages.includes(row.id)){
                          setSelectedImages(selectedImages.filter((item)=>(item !== row.id)));
                        } else {
                          setSelectedImages([...selectedImages, row.id]);
                        }
                      }} />
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