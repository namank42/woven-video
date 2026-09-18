import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const homepageSource = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
const agentSource = readFileSync(join(process.cwd(), "components/agent-edit-preview.tsx"), "utf8");
const switcherSource = readFileSync(
  join(process.cwd(), "components/caption-switcher.tsx"),
  "utf8",
);
const transitionSource = readFileSync(
  join(process.cwd(), "components/transition-switcher.tsx"),
  "utf8",
);
const textSource = readFileSync(
  join(process.cwd(), "components/text-animation-switcher.tsx"),
  "utf8",
);
const playerSource = readFileSync(
  join(process.cwd(), "components/switcher-player.tsx"),
  "utf8",
);
const sfxSource = readFileSync(
  join(process.cwd(), "components/sfx-soundboard.tsx"),
  "utf8",
);

const CAPTION_STYLES = ["highlight", "word-by-word", "progressive", "subtitles"] as const;
const TEXT_ANIMS = [
  "pop",
  "word-spring",
  "typewriter",
  "fade-out",
  "shrink",
  "slide-out",
  "pulse",
  "float",
  "shimmer",
] as const;
const SFX_PADS = [
  "fast-whoosh",
  "pop-hand",
  "glitch-logo",
  "bass-impact",
  "record-scratch",
  "notification-ding",
  "deep-whoosh",
  "camera-shutter-8-shots",
  "several-coins",
  "explosion",
  "swish-whoosh-large",
  "message-pop-reply",
] as const;
const TRANSITIONS = [
  "fade",
  "slide-left",
  "slide-right",
  "slide-up",
  "wipe",
  "whoosh",
  "zoom-blur",
  "glitch",
  "flash",
  "dynamic-smear",
  "pull-out",
  "tv-glitch",
  "pull-in",
] as const;

describe("homepage features", () => {
  it("embeds the agent fast-edit demo with poster, dimensions, and controls", () => {
    expect(homepageSource).toContain("<AgentEditPreview />");
    expect(agentSource).toContain("woven-agent-fast-edit-v1.mp4");
    expect(agentSource).toContain("woven-agent-fast-edit-v1.png");
    expect(agentSource).toContain("width={2160}");
    expect(agentSource).toContain("height={1236}");
    expect(agentSource).toContain("<PlayerControls");
  });

  it("gates preview autoplay on motion preferences", () => {
    for (const source of [agentSource, switcherSource, transitionSource, textSource]) {
      expect(source).not.toContain("autoPlay");
      for (const attr of ["muted", "loop", "playsInline"]) {
        expect(source).toContain(attr);
      }
    }
    expect(playerSource).toContain('window.matchMedia("(prefers-reduced-motion: reduce)")');
    expect(playerSource).toContain("resumePlaying.current = !preference.matches");
  });

  it("stacks the showcases agent, captions, transitions, then text", () => {
    expect(homepageSource).toContain("<CaptionSwitcher />");
    expect(homepageSource).toContain("<TransitionSwitcher />");
    expect(homepageSource).toContain("<TextAnimationSwitcher />");
    expect(homepageSource.indexOf("<AgentEditShowcase />")).toBeLessThan(
      homepageSource.indexOf("<CaptionShowcase />"),
    );
    expect(homepageSource.indexOf("<CaptionShowcase />")).toBeLessThan(
      homepageSource.indexOf("<TransitionShowcase />"),
    );
    expect(homepageSource.indexOf("<TransitionShowcase />")).toBeLessThan(
      homepageSource.indexOf("<TextAnimationShowcase />"),
    );
  });

  it.each(CAPTION_STYLES)("ships the %s caption clip and poster", (style) => {
    expect(switcherSource).toContain(
      `https://media.wovenlabs.net/woven-features/linger-captions-${style}-web.mp4`,
    );
    expect(switcherSource).toContain(
      `https://media.wovenlabs.net/woven-features/linger-captions-${style}-poster.jpg`,
    );
  });

  it("exposes the styles as an accessible tablist", () => {
    expect(switcherSource).toContain('role="tablist"');
    expect(switcherSource).toContain('role="tab"');
    expect(switcherSource).toContain('aria-selected');
  });

  it("lists all 13 transitions with clips and posters", () => {
    for (const slug of TRANSITIONS) {
      expect(transitionSource).toContain(`"${slug}"`);
    }
    expect(transitionSource).toContain(
      "transition-${t.id}-${ASSET_VERSION}-web.mp4",
    );
    expect(transitionSource).toContain(
      "transition-${t.id}-${ASSET_VERSION}-poster.jpg",
    );
    expect(transitionSource).toContain('ASSET_VERSION = "v4"');
    expect(transitionSource).toContain('role="tablist"');
    expect(transitionSource).toContain('role="tab"');
  });

  it("lists all 9 text animations grouped in entrances, exits, loops", () => {
    for (const slug of TEXT_ANIMS) {
      expect(textSource).toContain(`"${slug}"`);
    }
    expect(textSource).toContain("text-${t.id}-${ASSET_VERSION}-web.mp4");
    expect(textSource).toContain("text-${t.id}-${ASSET_VERSION}-poster.jpg");
    expect(textSource).toContain('ASSET_VERSION = "v2"');
    for (const group of ["Entrances", "Exits", "Loops"]) {
      expect(textSource).toContain(group);
    }
    expect(textSource).toContain('role="tablist"');
    expect(textSource).toContain('role="tab"');
  });

  it("keeps switchers manual with slide-left and typewriter defaults", () => {
    expect(transitionSource).not.toContain("useAutoCycle");
    expect(textSource).not.toContain("useAutoCycle");
    expect(playerSource).not.toContain("useAutoCycle");
    expect(transitionSource).toContain('useState("slide-left")');
    expect(textSource).toContain('useState("typewriter")');
  });

  it("marks the transition window on a seekable timeline", () => {
    expect(transitionSource).toContain('role="slider"');
    expect(transitionSource).toContain("TRANSITION_START = 0.6");
    expect(transitionSource).toContain("TRANSITION_END = 1.0");
    expect(transitionSource).toContain("FALLBACK_DURATION = 1.6");
  });

  it("lays caption options out in a 2x2 grid", () => {
    expect(switcherSource).toContain("grid grid-cols-2");
  });

  it("ends the gallery with the soundboard and no card grid", () => {
    expect(homepageSource).toContain("<SfxSoundboard />");
    expect(homepageSource.indexOf("<TextAnimationShowcase />")).toBeLessThan(
      homepageSource.indexOf("<SfxShowcase />"),
    );
    expect(homepageSource).not.toContain("featureCards");
  });

  it("curates 12 SFX pads from the CDN with waveforms and volumes", () => {
    for (const slug of SFX_PADS) {
      expect(sfxSource).toContain(`"${slug}"`);
    }
    expect(sfxSource).toContain("https://assets.sfx.woven.video/sfx/");
    expect(sfxSource).toContain("/sfx/peaks/");
    expect(sfxSource).toContain("aria-pressed");
    expect(sfxSource).toContain("every pad has a keyboard key");
    expect(sfxSource).toContain('href="/sfx"');
  });

  it("plays pads through one shared audio element", () => {
    expect(sfxSource.match(/new Audio\(\)/g)).toHaveLength(1);
    expect(sfxSource).toContain("audio.volume = pad.volume");
    expect(sfxSource).toContain(".play()");
    expect(sfxSource).toContain("requestAnimationFrame");
  });

  it("includes the approved showcase headlines and supporting copy", () => {
    for (const title of [
      "The details that make the edit.",
      "Describe the edit. Watch it happen.",
      "Your words. Your style.",
      "Set the pace between shots.",
      "Give your text an entrance.",
      "Make the moment land.",
    ]) {
      expect(homepageSource).toContain(title);
    }
    expect(homepageSource.match(/body="/g)).toHaveLength(5);
    expect(homepageSource).toContain("{body}");
    expect(homepageSource).not.toContain("eyebrow");
    expect(homepageSource).not.toContain("Every clip below came from a chat prompt.");
  });
});
