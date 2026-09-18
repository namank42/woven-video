"use client";

import { PlayerControls, useSwitcherPlayback } from "@/components/switcher-player";

export function AgentEditPreview() {
  const { videoRef, handleLoadedData, setIsPlaying, isPlaying, muted, togglePlay, toggleMute } = useSwitcherPlayback();
  return (
    <div className="relative overflow-hidden rounded-2xl shadow-xl shadow-foreground/10 ring-1 ring-foreground/10">
      <video
        ref={videoRef}
        muted
        loop
        playsInline
        preload="metadata"
        poster="https://media.woven.video/woven-agent-fast-edit-v1.png"
        width={2160}
        height={1236}
        onLoadedData={handleLoadedData}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        aria-label="Woven agent rebuilding the Linger reel from one chat prompt"
        className="block h-auto w-full"
      >
        <source src="https://media.woven.video/woven-agent-fast-edit-v1.mp4" type="video/mp4" />
      </video>
      <PlayerControls
        isPlaying={isPlaying}
        muted={muted}
        showMute={false}
        onTogglePlay={togglePlay}
        onToggleMute={toggleMute}
      />
    </div>
  );
}
