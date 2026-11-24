import React, { useMemo, useRef } from "react";
import { LIMITS, type PeakBuckets } from "@stiksound/core";

export interface Timeline5sBarProps {
  hasAudio: boolean;
  durationMs: number;
  startMs: number;
  endMs: number;
  maxWindowMs?: number;
  peaks: PeakBuckets | null;
  isPlaying: boolean;
  isBusy: boolean;
  urlInput: string;
  onUrlInputChange: (value: string) => void;
  onSubmitUrl: (url: string) => void;
  onSelectAudioFile: (file: File) => void;
  onChangeRange: (startMs: number, endMs: number) => void;
  onTogglePlay: () => void;
  labels: {
    placeholder: string;
    pickBtn: string;
    play: string;
    stop: string;
  };
}

function formatSec(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export const Timeline5sBar: React.FC<Timeline5sBarProps> = ({
  hasAudio,
  durationMs,
  startMs,
  endMs,
  maxWindowMs = LIMITS.DEFAULT_VIDEO_MAX_AUDIO_MS,
  peaks,
  isPlaying,
  isBusy,
  urlInput,
  onUrlInputChange,
  onSubmitUrl,
  onSelectAudioFile,
  onChangeRange,
  onTogglePlay,
  labels
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const selectedMs = Math.max(0, endMs - startMs);
  const windowLeftPct = durationMs > 0 ? (startMs / durationMs) * 100 : 0;
  const windowWidthPct = durationMs > 0 ? ((endMs - startMs) / durationMs) * 100 : 100;

  const downsampledBars = useMemo(() => {
    const count = 48;
    if (!peaks || peaks.buckets === 0) {
      return Array.from({ length: count }, () => 0.35);
    }
    const bars: number[] = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.min(peaks.buckets - 1, Math.floor((i * peaks.buckets) / count));
      const amp = Math.max(Math.abs(peaks.mins[idx] ?? 0), Math.abs(peaks.maxs[idx] ?? 0));
      bars.push(Math.max(0.12, Math.min(1, amp)));
    }
    return bars;
  }, [peaks]);

  const handleTrackPointer = (clientX: number) => {
    if (!trackRef.current || durationMs <= 0) return;
    const rect = trackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const clickedMs = Math.round(ratio * durationMs);
    const windowSize = Math.min(maxWindowMs, durationMs);
    const nextStart = Math.max(0, Math.min(durationMs - windowSize, Math.round(clickedMs - windowSize / 2)));
    onChangeRange(nextStart, nextStart + windowSize);
  };

  return (
    <div
      data-testid="timeline-bar"
      className="stik-timeline-bar"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) onSelectAudioFile(file);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onSelectAudioFile(f);
          e.target.value = "";
        }}
      />

      {!hasAudio ? (
        <form
          className="stik-audio-empty-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (urlInput.trim()) onSubmitUrl(urlInput.trim());
          }}
        >
          <input
            type="url"
            data-testid="myinstants-url-input"
            className="stik-url-input"
            value={urlInput}
            disabled={isBusy}
            placeholder={labels.placeholder}
            onChange={(e) => onUrlInputChange(e.target.value)}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text/plain").trim();
              if (/^https?:\/\//i.test(text)) {
                e.preventDefault();
                onUrlInputChange(text);
                onSubmitUrl(text);
              }
            }}
          />
          <button
            type="button"
            className="stik-pill-btn"
            disabled={isBusy}
            onClick={() => fileRef.current?.click()}
          >
            {labels.pickBtn}
          </button>
        </form>
      ) : (
        <div className="stik-timeline-active">
          <button
            type="button"
            data-testid="play-preview-btn"
            className="stik-play-btn"
            aria-label={isPlaying ? labels.stop : labels.play}
            onClick={onTogglePlay}
          >
            {isPlaying ? "■" : "▶"}
          </button>

          <div
            ref={trackRef}
            data-testid="waveform-track"
            className="stik-waveform-track"
            onClick={(e) => handleTrackPointer(e.clientX)}
          >
            <div className="stik-waveform-bars">
              {downsampledBars.map((amp, i) => (
                <span
                  key={i}
                  className="stik-waveform-bar"
                  style={{ height: `${Math.round(amp * 100)}%` }}
                />
              ))}
            </div>
            <div
              data-testid="trim-window"
              className="stik-trim-window"
              style={{
                left: `${windowLeftPct}%`,
                width: `${Math.max(4, windowWidthPct)}%`
              }}
            />
          </div>

          {durationMs > maxWindowMs && (
            <input
              type="range"
              data-testid="trim-slider"
              aria-label="5s window position"
              className="stik-trim-slider"
              min={0}
              max={Math.max(0, durationMs - maxWindowMs)}
              step={50}
              value={startMs}
              onChange={(e) => {
                const nextStart = Number(e.target.value);
                onChangeRange(nextStart, Math.min(durationMs, nextStart + maxWindowMs));
              }}
            />
          )}

          <span data-testid="duration-readout" className="stik-duration-pill">
            {formatSec(selectedMs)} / 5.0s
          </span>
        </div>
      )}
    </div>
  );
};
