import type { MediaKind, MediaOperation } from "@/lib/media/types";

const OPERATION_KIND = {
  image_generation: "image",
  video_generation: "video",
  text_to_speech: "audio",
  sound_effects: "audio",
  music_generation: "audio",
  reel_captions: "captions",
} satisfies Record<MediaOperation, MediaKind>;

export type TriggerableMediaKind = "image" | "video" | "audio";

export function mediaKindForOperation(operation: string): MediaKind | null {
  return Object.prototype.hasOwnProperty.call(OPERATION_KIND, operation)
    ? OPERATION_KIND[operation as MediaOperation]
    : null;
}

export function triggerMediaKindForOperation(operation: string): TriggerableMediaKind | null {
  const kind = mediaKindForOperation(operation);
  return kind === "image" || kind === "video" || kind === "audio" ? kind : null;
}
