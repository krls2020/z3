import { connectionAtomRuntime } from "../connection/runtime";
import { createZeropsFeedAtoms } from "../zerops/feeds";

export const zeropsFeeds = createZeropsFeedAtoms(connectionAtomRuntime);
