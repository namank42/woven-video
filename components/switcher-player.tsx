"use client";

import { useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon, Volume2Icon, VolumeXIcon } from "lucide-react";

export type SwitcherOption = {
  id: string;
  label: string;
  videoUrl: string;
  posterUrl: string;
};

/**
 * Shared playback logic for the feature video switchers. Switching preserves
 * playback position on a single <video> element so it feels like restyling
 * the same footage live.
 */
export function useSwitcherPlayback() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const pendingTime = useRef<number | null>(null);
  const resumePlaying = useRef(false);

  // Start only after checking motion preferences; source switches preserve pause.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    video.muted = true;
    resumePlaying.current = !preference.matches;
    if (resumePlaying.current) void video.play().catch(() => {});
    const onChange = () => {
      if (preference.matches) {
        resumePlaying.current = false;
        video.pause();
      }
    };
    preference.addEventListener("change", onChange);
    return () => preference.removeEventListener("change", onChange);
  }, []);

  /** Capture position before the parent swaps the active option. */
  const captureSwitch = () => {
    const v = videoRef.current;
    if (pendingTime.current == null) {
      pendingTime.current = v ? v.currentTime : 0;
      resumePlaying.current = v ? !v.paused : false;
    }
  };

  const handleLoadedData = () => {
    const v = videoRef.current;
    if (!v) return;
    if (pendingTime.current == null) {
      if (resumePlaying.current) void v.play().catch(() => {});
      return;
    }
    const t = Math.min(pendingTime.current, v.duration || 0);
    pendingTime.current = null;
    try {
      v.currentTime = Number.isFinite(t) ? t : 0;
    } catch {
      // Seeking can throw on unseekable streams; play from the top instead.
    }
    if (resumePlaying.current) v.play().catch(() => {});
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    resumePlaying.current = v.paused;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    const next = !muted;
    v.muted = next;
    setMuted(next);
  };

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (v) setCurrentTime(v.currentTime);
  };

  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (v && Number.isFinite(v.duration)) setDuration(v.duration);
  };

  const seekTo = (fraction: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
    const clamped = Math.min(Math.max(fraction, 0), 1);
    try {
      v.currentTime = clamped * v.duration;
    } catch {
      return;
    }
    setCurrentTime(clamped * v.duration);
  };

  return {
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
  };
}

/** Flips to true once the container nears the viewport (for preloading). */
export function usePreloadNearViewport(rootMargin = "400px") {
  const containerRef = useRef<HTMLDivElement>(null);
  const [preloadAll, setPreloadAll] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || preloadAll) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPreloadAll(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [preloadAll, rootMargin]);

  return { containerRef, preloadAll, preloadNow: () => setPreloadAll(true) };
}

export function PlayerControls({
  isPlaying,
  muted,
  showMute,
  onTogglePlay,
  onToggleMute,
}: {
  isPlaying: boolean;
  muted: boolean;
  showMute: boolean;
  onTogglePlay: () => void;
  onToggleMute: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTogglePlay();
        }}
        aria-label={isPlaying ? "Pause preview" : "Play preview"}
        className="absolute bottom-3 left-3 flex size-11 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors duration-150 hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      >
        {isPlaying ? (
          <PauseIcon className="size-3.5 fill-current" />
        ) : (
          <PlayIcon className="size-3.5 fill-current translate-x-px" />
        )}
      </button>
      {showMute && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleMute();
          }}
          aria-label={muted ? "Unmute preview" : "Mute preview"}
          className="absolute bottom-3 right-3 flex size-11 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors duration-150 hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        >
          {muted ? (
            <VolumeXIcon className="size-3.5" />
          ) : (
            <Volume2Icon className="size-3.5" />
          )}
        </button>
      )}
    </>
  );
}
