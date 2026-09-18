"use client";

import { useState } from "react";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { cn } from "@/lib/utils";
import {
  PlayerControls,
  usePreloadNearViewport,
  useSwitcherPlayback,
  type SwitcherOption,
} from "@/components/switcher-player";

export type CaptionStyle = SwitcherOption & {
  blurb: string;
};

export const CAPTION_STYLES: CaptionStyle[] = [
  {
    id: "highlight",
    label: "Highlight",
    blurb: "Active word pops in yellow.",
    videoUrl:
      "https://media.wovenlabs.net/woven-features/linger-captions-highlight-web.mp4",
    posterUrl:
      "https://media.wovenlabs.net/woven-features/linger-captions-highlight-poster.jpg",
  },
  {
    id: "word-by-word",
    label: "Word by word",
    blurb: "One word at a time.",
    videoUrl:
      "https://media.wovenlabs.net/woven-features/linger-captions-word-by-word-web.mp4",
    posterUrl:
      "https://media.wovenlabs.net/woven-features/linger-captions-word-by-word-poster.jpg",
  },
  {
    id: "progressive",
    label: "Progressive",
    blurb: "Builds up as it's spoken.",
    videoUrl:
      "https://media.wovenlabs.net/woven-features/linger-captions-progressive-web.mp4",
    posterUrl:
      "https://media.wovenlabs.net/woven-features/linger-captions-progressive-poster.jpg",
  },
  {
    id: "subtitles",
    label: "Subtitles",
    blurb: "Full lines, always readable.",
    videoUrl:
      "https://media.wovenlabs.net/woven-features/linger-captions-subtitles-web.mp4",
    posterUrl:
      "https://media.wovenlabs.net/woven-features/linger-captions-subtitles-poster.jpg",
  },
];

/**
 * Interactive caption-style switcher. One player, four treatments of the same
 * Linger reel. Switching preserves playback position so it feels like
 * restyling the footage live. Inactive styles preload once the switcher
 * nears the viewport so switches land instantly.
 */
export function CaptionSwitcher() {
  const [activeId, setActiveId] = useState(CAPTION_STYLES[0].id);
  const { containerRef, preloadAll } = usePreloadNearViewport();
  const {
    videoRef,
    muted,
    isPlaying,
    setIsPlaying,
    captureSwitch,
    handleLoadedData,
    togglePlay,
    toggleMute,
  } = useSwitcherPlayback();

  const active =
    CAPTION_STYLES.find((s) => s.id === activeId) ?? CAPTION_STYLES[0];

  const switchStyle = (id: string) => {
    if (id === activeId) return;
    captureSwitch();
    setActiveId(id);
  };

  const handleTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    // Options sit in a 2-column grid: left/right move within a row,
    // up/down move between rows.
    const cols = 2;
    const len = CAPTION_STYLES.length;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (index + 1) % len;
    else if (e.key === "ArrowLeft") next = (index - 1 + len) % len;
    else if (e.key === "ArrowDown") next = (index + cols) % len;
    else if (e.key === "ArrowUp") next = (index - cols + len) % len;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = len - 1;
    if (next == null) return;
    e.preventDefault();
    switchStyle(CAPTION_STYLES[next].id);
    containerRef.current
      ?.querySelector<HTMLButtonElement>(`[data-tab-index="${next}"]`)
      ?.focus();
  };

  return (
    <div ref={containerRef} className="grid gap-6 lg:row-span-2 lg:grid-rows-subgrid">
      <div role="tabpanel" aria-label={`${active.label} captions preview`}>
        <div className="mx-auto w-full max-w-[240px]">
          <AspectRatio
            ratio={9 / 16}
            className="group relative cursor-pointer overflow-hidden rounded-2xl bg-foreground/5 ring-1 ring-foreground/10"
            onClick={togglePlay}
          >
            <video
              ref={videoRef}
              src={active.videoUrl}
              poster={active.posterUrl}
              muted
              loop
              playsInline
              preload="metadata"
              onLoadedData={handleLoadedData}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              aria-label={`Linger reel with ${active.label} captions`}
              className="size-full object-cover"
            />
            <PlayerControls
              isPlaying={isPlaying}
              muted={muted}
              showMute
              onTogglePlay={togglePlay}
              onToggleMute={toggleMute}
            />
          </AspectRatio>
        </div>
        {preloadAll &&
          CAPTION_STYLES.filter((s) => s.id !== activeId).map((s) => (
            <video
              key={s.id}
              src={s.videoUrl}
              preload="auto"
              muted
              playsInline
              aria-hidden="true"
              tabIndex={-1}
              className="hidden"
            />
          ))}
      </div>

      <div>
        <div
          role="tablist"
          aria-label="Caption styles"
          className="grid grid-cols-2 gap-2"
        >
          {CAPTION_STYLES.map((style, i) => {
            const selected = style.id === activeId;
            return (
              <button
                key={style.id}
                type="button"
                role="tab"
                data-tab-index={i}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => switchStyle(style.id)}
                onKeyDown={(e) => handleTabKeyDown(e, i)}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-4 py-3 text-left ring-1 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  selected
                    ? "bg-foreground text-background ring-foreground"
                    : "bg-background text-foreground ring-border hover:ring-foreground/30",
                )}
              >
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold tracking-tight">
                    {style.label}
                  </span>
                  <span
                    className={cn(
                      "text-sm",
                      selected ? "text-background/70" : "text-muted-foreground",
                    )}
                  >
                    {style.blurb}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
