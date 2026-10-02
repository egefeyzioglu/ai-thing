import { createImagesEnvironmentAtoms } from "@t3tools/client-runtime/state/images";

import { connectionAtomRuntime } from "../connection/runtime";

export const imagesEnvironment = createImagesEnvironmentAtoms(connectionAtomRuntime);
