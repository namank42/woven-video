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

// Bump on re-export: edge cache holds old bytes ~4h (and a raced first
// request can poison a fresh key with a cached 404), so new renders ship
// under a new version instead of overwriting in place. Verify new keys via
// a unique query (?verify=N) before requesting bare URLs.
const ASSET_VERSION = "v2";

type TextGroup = {
  label: string;
  options: SwitcherOption[];
};

const TEXT_GROUPS: TextGroup[] = (
  [
    {
      label: "Entrances",
      options: [
        { id: "pop", label: "Pop" },
        { id: "word-spring", label: "Word spring" },
        { id: "typewriter", label: "Typewriter" },
      ],
    },
    {
      label: "Exits",
      options: [
        { id: "fade-out", label: "Fade out" },
        { id: "shrink", label: "Shrink" },
        { id: "slide-out", label: "Slide out" },
      ],
    },
    {
      label: "Loops",
      options: [
        { id: "pulse", label: "Pulse" },
        { id: "float", label: "Float" },
        { id: "shimmer", label: "Shimmer" },
      ],
    },
  ] as const
).map((group) => ({
  label: group.label,
  options: group.options.map((t) => ({
    ...t,
    videoUrl: `https://media.wovenlabs.net/woven-features/text-${t.id}-${ASSET_VERSION}-web.mp4`,
    posterUrl: `https://media.wovenlabs.net/woven-features/text-${t.id}-${ASSET_VERSION}-poster.jpg`,
  })),
}));

const ALL_OPTIONS = TEXT_GROUPS.flatMap((g) => g.options);

/**
 * Interactive text-animation switcher. One player, nine treatments of the
 * same "Build Your World" title. The clips are silent 1.5s loops, so there
 * is no mute toggle and no timeline.
 */
export function TextAnimationSwitcher() {
  const [activeId, setActiveId] = useState("typewriter");
  const { containerRef, preloadAll, preloadNow } =
    usePreloadNearViewport("200px");
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
    ALL_OPTIONS.find((t) => t.id === activeId) ?? ALL_OPTIONS[0];

  const switchAnimation = (id: string) => {
    if (id === activeId) return;
    captureSwitch();
    setActiveId(id);
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next: number | null = null;
    if (e.key === "ArrowDown" || e.key === "ArrowRight")
      next = (index + 1) % ALL_OPTIONS.length;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft")
      next = (index - 1 + ALL_OPTIONS.length) % ALL_OPTIONS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = ALL_OPTIONS.length - 1;
    if (next == null) return;
    e.preventDefault();
    switchAnimation(ALL_OPTIONS[next].id);
    containerRef.current
      ?.querySelector<HTMLButtonElement>(`[data-tab-index="${next}"]`)
      ?.focus();
  };

  return (
    <div ref={containerRef} className="grid gap-6 lg:row-span-2 lg:grid-rows-subgrid">
      <div role="tabpanel" aria-label={`${active.label} text animation preview`}>
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
              aria-label={`Build Your World title with ${active.label} animation`}
              className="size-full object-cover"
            />
            <PlayerControls
              isPlaying={isPlaying}
              muted={muted}
              showMute={false}
              onTogglePlay={togglePlay}
              onToggleMute={toggleMute}
            />
          </AspectRatio>
        </div>
        {preloadAll &&
          ALL_OPTIONS.filter((t) => t.id !== activeId).map((t) => (
            <video
              key={t.id}
              src={t.videoUrl}
              preload="auto"
              muted
              playsInline
              aria-hidden="true"
              tabIndex={-1}
              className="hidden"
            />
          ))}
      </div>

      <div onMouseEnter={preloadNow} onFocus={preloadNow}>
        <div
          role="tablist"
          aria-label="Text animations"
          className="grid gap-5 md:grid-cols-3 md:gap-3"
        >
          {TEXT_GROUPS.map((group) => (
            <div key={group.label}>
              <p
                aria-hidden="true"
                className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground"
              >
                {group.label}
              </p>
              <div className="grid grid-cols-[max-content_max-content] justify-start gap-1.5" role="group" aria-label={group.label}>
                {group.options.map((option) => {
                  const index = ALL_OPTIONS.indexOf(option);
                  const selected = option.id === activeId;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="tab"
                      data-tab-index={index}
                      aria-selected={selected}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => switchAnimation(option.id)}
                      onKeyDown={(e) => handleKeyDown(e, index)}
                      className={cn(
                        "rounded-full px-2.5 py-1.5 text-[13px] font-medium ring-1 last:col-span-2 last:justify-self-start transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        selected
                          ? "bg-foreground text-background ring-foreground"
                          : "bg-background text-foreground ring-border hover:ring-foreground/30",
                      )}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
