"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { usePreloadNearViewport } from "@/components/switcher-player";

type SfxPad = {
  id: string;
  label: string;
  durationMs: number;
  volume: number;
  key: string;
};

// Curated slice of the open library (woven.video/sfx/catalog.json): short,
// punchy one-shots across whoosh / pop / glitch / impact / ding. Volumes are
// the catalog default_volume values. Audio streams from the SFX CDN on tap
// only (autoplay policies require the gesture anyway); waveforms come from
// the peaks JSON behind the /sfx rewrite, fetched once near the viewport.
const PADS: SfxPad[] = [
  { id: "fast-whoosh", label: "Fast whoosh", durationMs: 395, volume: 0.45, key: "1" },
  { id: "pop-hand", label: "Pop", durationMs: 348, volume: 0.4, key: "2" },
  { id: "glitch-logo", label: "Glitch", durationMs: 627, volume: 0.4, key: "3" },
  { id: "bass-impact", label: "Bass impact", durationMs: 2461, volume: 0.55, key: "4" },
  { id: "record-scratch", label: "Scratch", durationMs: 1277, volume: 0.4, key: "5" },
  { id: "notification-ding", label: "Ding", durationMs: 1997, volume: 0.4, key: "6" },
  { id: "deep-whoosh", label: "Deep whoosh", durationMs: 3228, volume: 0.45, key: "7" },
  {
    id: "camera-shutter-8-shots",
    label: "Shutters",
    durationMs: 1115,
    volume: 0.4,
    key: "8",
  },
  { id: "several-coins", label: "Coins", durationMs: 1416, volume: 0.4, key: "9" },
  { id: "explosion", label: "Explosion", durationMs: 3181, volume: 0.45, key: "0" },
  { id: "swish-whoosh-large", label: "Swish", durationMs: 789, volume: 0.45, key: "Q" },
  { id: "message-pop-reply", label: "Message pop", durationMs: 882, volume: 0.4, key: "W" },
];

const audioUrl = (id: string) => `https://assets.sfx.woven.video/sfx/${id}.wav`;
const peaksUrl = (id: string) => `/sfx/peaks/${id}.json`;

// The catalog peaks (~32 buckets) render as spiky 2px slivers in a narrow
// pad, so resample down to fewer, chunkier bars with a smoother envelope.
const WAVEFORM_BARS = 20;

function resample(peaks: number[], count: number): number[] {
  const out: number[] = [];
  const bucket = peaks.length / count;
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucket));
    const slice = peaks.slice(start, end);
    out.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  return out;
}

function Waveform({
  peaks,
  progress,
}: {
  peaks: number[] | null;
  /** 0–1 playback progress, or null when idle. */
  progress: number | null;
}) {
  const bars = useMemo(
    () => (peaks ? resample(peaks, WAVEFORM_BARS) : null),
    [peaks],
  );
  if (!bars) {
    return (
      <div aria-hidden="true" className="flex h-8 items-center gap-[3px]">
        {Array.from({ length: WAVEFORM_BARS }).map((_, i) => (
          <span key={i} className="w-full rounded-full bg-foreground/15" style={{ height: "12%" }} />
        ))}
      </div>
    );
  }
  return (
    <div aria-hidden="true" className="flex h-8 items-center gap-[3px]">
      {bars.map((peak, i) => {
        const played = progress != null && i / bars.length <= progress;
        return (
          <span
            key={i}
            className={cn(
              "w-full rounded-full",
              played ? "bg-foreground" : "bg-foreground/25",
            )}
            style={{ height: `${Math.max(8, Math.min(1, peak) * 100)}%` }}
          />
        );
      })}
    </div>
  );
}

/**
 * Interactive SFX soundboard. Twelve pads from the open woven-sfx library,
 * each with a real waveform. One shared Audio element: tapping a pad plays
 * it (stopping whatever was playing), tapping again stops. Each pad has a
 * keyboard shortcut that works while focus is inside the board.
 */
export function SfxSoundboard() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [peaks, setPeaks] = useState<Record<string, number[]>>({});
  const playToken = useRef(0);
  const { containerRef, preloadAll } = usePreloadNearViewport("200px");

  useEffect(() => {
    if (!preloadAll) return;
    let cancelled = false;
    void Promise.all(
      PADS.map(async (pad) => {
        try {
          const res = await fetch(peaksUrl(pad.id));
          if (!res.ok) return;
          const data: unknown = await res.json();
          if (
            !cancelled &&
            Array.isArray(data) &&
            data.every((v) => typeof v === "number")
          ) {
            setPeaks((prev) => ({ ...prev, [pad.id]: data }));
          }
        } catch {
          // Keep the placeholder bars.
        }
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [preloadAll]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
    },
    [],
  );

  // Drive the waveform fill on the playing pad, like the /sfx library cards.
  useEffect(() => {
    if (!playingId) return;
    const fallbackMs =
      PADS.find((p) => p.id === playingId)?.durationMs ?? 0;
    let raf = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        const duration =
          Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration
            : fallbackMs / 1000;
        setProgress(
          duration > 0 ? Math.min(1, audio.currentTime / duration) : 0,
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playingId]);

  const toggle = (pad: SfxPad) => {
    if (!audioRef.current) {
      const el = new Audio();
      el.preload = "none";
      el.addEventListener("ended", () => setPlayingId(null));
      audioRef.current = el;
    }
    const audio = audioRef.current;
    if (playingId === pad.id) {
      audio.pause();
      audio.currentTime = 0;
      setPlayingId(null);
      return;
    }
    const token = ++playToken.current;
    audio.src = audioUrl(pad.id);
    audio.volume = pad.volume;
    setProgress(0);
    setPlayingId(pad.id);
    audio
      .play()
      .catch(() => {
        // Only clear if a newer tap hasn't already taken over the element.
        if (token === playToken.current) setPlayingId(null);
      });
  };

  // Each pad's shortcut plays it, but only when focus is already inside
  // the board, so the shortcuts never hijack typing elsewhere on the page.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (!containerRef.current?.contains(document.activeElement)) return;
      const pad = PADS.find((p) => p.key.toLowerCase() === e.key.toLowerCase());
      if (!pad) return;
      e.preventDefault();
      toggle(pad);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div ref={containerRef} className="flex flex-col gap-4 lg:row-span-2">
      <p className="text-sm text-muted-foreground">Tap a sound to preview.</p>
      <div role="group" aria-label="Sound effects board. Tap a pad to play it." className="grid grid-cols-3 gap-2 sm:gap-3">
        {PADS.map((pad) => {
          const playing = pad.id === playingId;
          return (
            <button
              key={pad.id}
              type="button"
              aria-pressed={playing}
              aria-label={`${playing ? "Stop" : "Play"} ${pad.label} sound effect`}
              onClick={() => toggle(pad)}
              className={cn(
                "group flex flex-col gap-2 rounded-2xl p-3 text-left ring-1 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:p-4",
                playing
                  ? "bg-foreground/[0.07] ring-foreground/40"
                  : "bg-background ring-border hover:ring-foreground/30",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <kbd
                  aria-hidden="true"
                  className="hidden size-5 items-center justify-center rounded-md text-[11px] font-medium text-muted-foreground ring-1 ring-border sm:flex"
                >
                  {pad.key}
                </kbd>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {playing ? "Playing" : `${(pad.durationMs / 1000).toFixed(1)}s`}
                </span>
              </span>
              <Waveform
                peaks={peaks[pad.id] ?? null}
                progress={playing ? progress : null}
              />
              <span className="truncate text-xs font-medium sm:text-sm">{pad.label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-4 text-sm">
        <p className="hidden text-muted-foreground sm:block">
          Tip: every pad has a keyboard key.
        </p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- /sfx is a rewrite to the woven-sfx app, not a local page */}
        <a
          href="/sfx"
          className="text-foreground underline underline-offset-4 transition-colors hover:text-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Browse all 35 sounds
        </a>
      </div>
    </div>
  );
}
