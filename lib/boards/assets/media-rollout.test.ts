import { describe, expect, it } from "vitest";

import {
  SUPPORTED_BOARD_IMAGE_MIME_TYPES,
  SUPPORTED_BOARD_VIDEO_MIME_TYPES,
} from "./contracts";
import { acceptedBoardMediaMimeTypes } from "./media-rollout";

describe("acceptedBoardMediaMimeTypes", () => {
  it("keeps baseline image paste/upload enabled while rollout is off", () => {
    expect(acceptedBoardMediaMimeTypes(false)).toEqual({
      images: SUPPORTED_BOARD_IMAGE_MIME_TYPES,
      videos: [],
    });
  });

  it("enables the R2 video surface only after workspace rollout", () => {
    expect(acceptedBoardMediaMimeTypes(true)).toEqual({
      images: SUPPORTED_BOARD_IMAGE_MIME_TYPES,
      videos: SUPPORTED_BOARD_VIDEO_MIME_TYPES,
    });
  });
});
