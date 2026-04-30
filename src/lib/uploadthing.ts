import {
  generateUploadButton,
  generateUploadDropzone,
} from "@uploadthing/react";

import type { UTFileRouter } from "src/app/api/uploadthing/core";

export const UTUploadButton = generateUploadButton<UTFileRouter>();
export const UTUploadDropzone = generateUploadDropzone<UTFileRouter>();
