import { describe, expect, it } from "vitest";
import { mediaKindForOperation, triggerMediaKindForOperation } from "@/lib/media/kind";

describe("media operation kind mapping", () => {
  it("maps known media operations explicitly", () => {
    expect(mediaKindForOperation("image_generation")).toBe("image");
    expect(mediaKindForOperation("video_generation")).toBe("video");
    expect(mediaKindForOperation("text_to_speech")).toBe("audio");
    expect(mediaKindForOperation("sound_effects")).toBe("audio");
    expect(mediaKindForOperation("music_generation")).toBe("audio");
    expect(mediaKindForOperation("reel_captions")).toBe("captions");
  });

  it("does not map unknown operations to video", () => {
    expect(mediaKindForOperation("unknown_generation")).toBeNull();
    expect(triggerMediaKindForOperation("unknown_generation")).toBeNull();
  });

  it("returns only Trigger-supported media kinds from triggerMediaKindForOperation", () => {
    expect(triggerMediaKindForOperation("image_generation")).toBe("image");
    expect(triggerMediaKindForOperation("video_generation")).toBe("video");
    expect(triggerMediaKindForOperation("music_generation")).toBe("audio");
    expect(triggerMediaKindForOperation("reel_captions")).toBeNull();
  });
});
