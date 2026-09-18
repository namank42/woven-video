"use client";

import { useRef, useState } from "react";
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
const ASSET_VERSION = "v4";

export const TRANSITION_OPTIONS: SwitcherOption[] = [
  { id: "fade", label: "Fade" },
  { id: "slide-left", label: "Slide left" },
  { id: "slide-right", label: "Slide right" },
  { id: "slide-up", label: "Slide up" },
  { id: "wipe", label: "Wipe" },
  { id: "whoosh", label: "Whoosh" },
  { id: "zoom-blur", label: "Zoom blur" },
  { id: "glitch", label: "Glitch" },
  { id: "flash", label: "Flash" },
  { id: "dynamic-smear", label: "Dynamic smear" },
  { id: "pull-out", label: "Pull out" },
  { id: "tv-glitch", label: "TV glitch" },
  { id: "pull-in", label: "Pull in" },
].map((t) => ({
  ...t,
  videoUrl: `https://media.wovenlabs.net/woven-features/transition-${t.id}-${ASSET_VERSION}-web.mp4`,
  posterUrl: `https://media.wovenlabs.net/woven-features/transition-${t.id}-${ASSET_VERSION}-poster.jpg`,
}));

// All clips share one template: the transition runs 0.6–1.0s of 1.6s.
const TRANSITION_START = 0.6;
const TRANSITION_END = 1.0;
const FALLBACK_DURATION = 1.6;

/**
 * Interactive transition switcher. One player, thirteen treatments of the
 * same two park clips. The clips are silent, so there is no mute toggle.
 */
export function TransitionSwitcher() {
  const [activeId, setActiveId] = useState("slide-left");
  const { containerRef, preloadAll, preloadNow } =
    usePreloadNearViewport("200px");
  const {
    videoRef,
    muted,
    isPlaying,
    setIsPlaying,
    currentTime,
    duration,
    captureSwitch,
    handleLoadedData,
    handleTimeUpdate,
    handleLoadedMetadata,
    seekTo,
    togglePlay,
    toggleMute,
  } = useSwitcherPlayback();

  const active =
    TRANSITION_OPTIONS.find((t) => t.id === activeId) ?? TRANSITION_OPTIONS[0];

  const switchTransition = (id: string) => {
    if (id === activeId) return;
    captureSwitch();
    setActiveId(id);
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next: number | null = null;
    if (e.key === "ArrowDown" || e.key === "ArrowRight")
      next = (index + 1) % TRANSITION_OPTIONS.length;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft")
      next =
        (index - 1 + TRANSITION_OPTIONS.length) % TRANSITION_OPTIONS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TRANSITION_OPTIONS.length - 1;
    if (next == null) return;
    e.preventDefault();
    switchTransition(TRANSITION_OPTIONS[next].id);
    containerRef.current
      ?.querySelector<HTMLButtonElement>(`[data-tab-index="${next}"]`)
      ?.focus();
  };

  return (
    <div ref={containerRef} className="grid gap-6 lg:row-span-2 lg:grid-rows-subgrid">
      <div role="tabpanel" aria-label={`${active.label} transition preview`}>
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
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              aria-label={`Park clips with ${active.label} transition`}
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
          <TransitionTimeline
            currentTime={currentTime}
            duration={duration}
            onSeek={seekTo}
          />
        </div>
        {preloadAll &&
          TRANSITION_OPTIONS.filter((t) => t.id !== activeId).map((t) => (
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
          aria-label="Transitions"
          className="flex flex-wrap gap-2"
        >
          {TRANSITION_OPTIONS.map((option, i) => {
            const selected = option.id === activeId;
            return (
              <button
                key={option.id}
                type="button"
                role="tab"
                data-tab-index={i}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => switchTransition(option.id)}
                onKeyDown={(e) => handleKeyDown(e, i)}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-medium ring-1 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background",
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
    </div>
  );
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function TransitionTimeline({
  currentTime,
  duration,
  onSeek,
}: {
  currentTime: number;
  duration: number;
  onSeek: (fraction: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const total = duration > 0 ? duration : FALLBACK_DURATION;
  const progress = Math.min(Math.max(currentTime / total, 0), 1);
  const windowLeft = (TRANSITION_START / total) * 100;
  const windowWidth = ((TRANSITION_END - TRANSITION_START) / total) * 100;

  const seekFromClientX = (clientX: number) => {
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return;
    onSeek((clientX - rect.left) / rect.width);
  };

  const handleSliderKeyDown = (e: React.KeyboardEvent) => {
    const step = 0.5 / total;
    const current = currentTime / total;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onSeek(current - step);
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onSeek(current + step);
    } else if (e.key === "Home") {
      e.preventDefault();
      onSeek(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onSeek(1);
    }
  };

  return (
    <div className="mt-3">
      <div
        ref={barRef}
        role="slider"
        tabIndex={0}
        aria-label="Seek transition preview"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(currentTime)}
        aria-valuetext={`${formatTime(currentTime)} of ${formatTime(total)}`}
        onClick={(e) => seekFromClientX(e.clientX)}
        onKeyDown={handleSliderKeyDown}
        className="flex h-11 cursor-pointer items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
      >
        <div className="relative h-1 w-full rounded-full bg-foreground/10">
          <div
            aria-hidden="true"
            style={{ width: `${progress * 100}%` }}
            className="absolute inset-y-0 left-0 rounded-full bg-foreground/40"
          />
          <div
            aria-hidden="true"
            title="Transition happens here"
            style={{ left: `${windowLeft}%`, width: `${windowWidth}%` }}
            className="absolute -inset-y-[3px] rounded-full bg-foreground"
          />
        </div>
      </div>
      <div className="mt-1 text-[11px] tabular-nums text-muted-foreground">
        {formatTime(currentTime)} / {formatTime(total)}
      </div>
    </div>
  );
}
