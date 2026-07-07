import { describe, expect, it } from "vitest";
import { parseMediaJobInputAssets } from "@/lib/media/input-assets";
import type { MediaInputAssetSchema } from "@/lib/media/types";

const referenceSchema: MediaInputAssetSchema = {
  roles: [
    { role: "reference_images", providerField: "image_urls", mediaKind: "image", required: false, min: 0, max: 9, contentTypePrefixes: ["image/"] },
    { role: "reference_videos", providerField: "video_urls", mediaKind: "video", required: false, min: 0, max: 3, contentTypePrefixes: ["video/"] },
    { role: "reference_audio", providerField: "audio_urls", mediaKind: "audio", required: false, min: 0, max: 3, contentTypePrefixes: ["audio/"] },
  ],
  constraints: [
    { type: "at_least_one_role", roles: ["reference_images", "reference_videos", "reference_audio"] },
    { type: "requires_any_role_when_role_present", role: "reference_audio", roles: ["reference_images", "reference_videos"] },
  ],
};

describe("parseMediaJobInputAssets", () => {
  it("rejects reference models with no uploaded reference assets", () => {
    expect(parseMediaJobInputAssets({
      model: { inputAssetSchema: referenceSchema },
      inputAssets: [],
      inputAssetIds: undefined,
    })).toEqual({
      ok: false,
      error: "input_assets requires at least one reference asset.",
    });
  });

  it("rejects reference audio without an image or video reference", () => {
    expect(parseMediaJobInputAssets({
      model: { inputAssetSchema: referenceSchema },
      inputAssets: [{ asset_id: "asset_audio", role: "reference_audio" }],
      inputAssetIds: undefined,
    })).toEqual({
      ok: false,
      error: "input_assets role reference_audio requires at least one image or video reference.",
    });
  });

  it("accepts reference audio when paired with an image reference", () => {
    expect(parseMediaJobInputAssets({
      model: { inputAssetSchema: referenceSchema },
      inputAssets: [
        { asset_id: "asset_image", role: "reference_images" },
        { asset_id: "asset_audio", role: "reference_audio" },
      ],
      inputAssetIds: undefined,
    })).toEqual({
      ok: true,
      inputAssets: [
        { assetId: "asset_image", role: "reference_images" },
        { assetId: "asset_audio", role: "reference_audio" },
      ],
      inputAssetIds: ["asset_image", "asset_audio"],
    });
  });
});
