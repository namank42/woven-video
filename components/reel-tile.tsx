"use client";

import { useRef, useState } from "react";
import { PauseIcon, PlayIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { AspectRatio } from "@/components/ui/aspect-ratio";

type ReelTileProps = {
  videoUrl?: string;
  posterUrl?: string;
  gradient: string;
};

export function ReelTile({ videoUrl, posterUrl, gradient }: ReelTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const togglePlay = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.muted = muted;
      v.play().catch(() => {});
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute: React.MouseEventHandler<HTMLButtonElement> = (e) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    const next = !muted;
    v.muted = next;
    setMuted(next);
  };

  if (!videoUrl) {
    return (
      <AspectRatio
        ratio={9 / 16}
        className="overflow-hidden rounded-2xl bg-foreground/5 ring-1 ring-foreground/10"
      >
        <div className={`relative size-full bg-gradient-to-br ${gradient}`}>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_60%)]" />
        </div>
      </AspectRatio>
    );
  }

  return (
    <AspectRatio
      ratio={9 / 16}
      className="group relative cursor-pointer overflow-hidden rounded-2xl bg-foreground/5 ring-1 ring-foreground/10"
      onClick={togglePlay}
    >
      <video
        ref={videoRef}
        src={videoUrl}
        poster={posterUrl}
        loop
        playsInline
        preload="metadata"
        className="size-full object-cover"
      />

      <button
        type="button"
        onClick={togglePlay}
        aria-label={isPlaying ? "Pause video" : "Play video"}
        className="absolute bottom-3 left-3 flex size-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition hover:bg-black/75"
      >
        {isPlaying ? (
          <PauseIcon className="size-3.5 fill-current" />
        ) : (
          <PlayIcon className="size-3.5 fill-current translate-x-px" />
        )}
      </button>

      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? "Unmute video" : "Mute video"}
        className="absolute bottom-3 right-3 flex size-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition hover:bg-black/75"
      >
        {muted ? (
          <VolumeXIcon className="size-3.5" />
        ) : (
          <Volume2Icon className="size-3.5" />
        )}
      </button>
    </AspectRatio>
  );
}
