import {
  SUPPORTED_BOARD_IMAGE_MIME_TYPES,
  SUPPORTED_BOARD_VIDEO_MIME_TYPES,
} from "@/lib/boards/assets/contracts";

export function acceptedBoardMediaMimeTypes(
  workspaceRolloutEnabled: boolean,
) {
  return {
    images: SUPPORTED_BOARD_IMAGE_MIME_TYPES,
    videos: workspaceRolloutEnabled ? SUPPORTED_BOARD_VIDEO_MIME_TYPES : [],
  } as const;
}
