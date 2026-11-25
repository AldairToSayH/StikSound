// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StikSoundError, type MediaEngine, type SoundProvider } from "@stiksound/core";
import { StikSoundMinimalApp } from "../src/index";

afterEach(() => {
  cleanup();
});

function createTestEngine(width = 800, height = 400, isGif = false): MediaEngine {
  return {
    async probeImage() {
      return {
        format: isGif ? "gif" : "png",
        width,
        height,
        has_alpha: true,
        animated: isGif,
        frame_count: isGif ? 6 : 1,
        duration_ms: isGif ? 1200 : 0
      };
    },
    async renderSticker() {
      return { width: 400, height: 400, data: new Uint8Array(400 * 400 * 4) };
    },
    async encodeWebp() {
      return new Uint8Array([0x52, 0x49, 0x46, 0x46]);
    },
    async probeAudio() {
      return { format: "mp3", duration_ms: 12_000, sample_rate: 44100, channels: 2 };
    },
    async waveform() {
      return {
        buckets: 1024,
        mins: new Float32Array(1024).fill(-0.4),
        maxs: new Float32Array(1024).fill(0.4)
      };
    },
    async renderAudio(_bytes, edit) {
      return {
        sampleRate: 48000,
        channels: 1,
        samples: new Float32Array(48000),
        durationMs: edit.end_ms - edit.start_ms
      };
    },
    async encodeOpus() {
      return new Uint8Array([0x4f, 0x67, 0x67, 0x53]);
    },
    async renderVideo(req) {
      return {
        bytes: new Uint8Array([1, 2, 3, 4]),
        mimeType: req.container === "webm-alpha" ? "video/webm" : "video/mp4",
        extension: req.container === "webm-alpha" ? "webm" : "mp4",
        durationMs: req.endMs - req.startMs,
        hasAlpha: req.container === "webm-alpha"
      };
    },
    async zip() {
      return new Uint8Array([0x50, 0x4b]);
    },
    async unzip() {
      return [];
    }
  };
}

describe("StikSoundMinimalApp UI", () => {
  it("supports GIF/PNG, zero-click hover 1:1 crop, arrow preview/copy, download format picker, and X reset", async () => {
    const saveArtifact = vi.fn().mockResolvedValue(undefined);
    const copyArtifactToClipboard = vi.fn().mockResolvedValue(undefined);
    const provider: SoundProvider = {
      id: "myinstants",
      canResolve: (u) => u.includes("myinstants.com"),
      resolve: async (u) => ({
        page_url: u,
        media_url: "https://www.myinstants.com/media/sounds/test.mp3",
        title: "Test Sound",
        bytes: new Uint8Array([0x49, 0x44, 0x33, 0x03])
      })
    };

    const { container } = render(
      <StikSoundMinimalApp
        engine={createTestEngine(800, 400, true)}
        providers={[provider]}
        shell={{ saveArtifact, copyArtifactToClipboard }}
        initialLocale="es"
      />
    );

    const okArrowBtn = screen.getByTestId("export-ok-btn") as HTMLButtonElement;
    const downloadBtn = screen.getByTestId("download-btn") as HTMLButtonElement;
    expect(okArrowBtn.disabled).toBe(true);
    expect(downloadBtn.disabled).toBe(true);

    // Drop a non-square 800x400 GIF onto the center sticker zone
    const stickerZone = screen.getByTestId("sticker-zone");
    Object.defineProperty(stickerZone, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200 })
    });
    const gifFile = new File([new Uint8Array([0x47, 0x49, 0x46, 0x38])], "dance.gif", { type: "image/gif" });
    Object.defineProperty(gifFile, "arrayBuffer", {
      value: async () => new Uint8Array([0x47, 0x49, 0x46, 0x38]).buffer
    });
    fireEvent.drop(stickerZone, { dataTransfer: { files: [gifFile] } });

    await waitFor(() => expect(screen.getByTestId("sticker-loaded-badge")).toBeTruthy());
    // Resolution badge shows input-driven 1:1 400x400 + hover hint
    expect(screen.getByTestId("resolution-pill").textContent).toContain("400×400");
    // Transparency picker is shown directly when alpha exists
    expect(screen.getByTestId("transparency-picker")).toBeTruthy();

    // Zero-click hover move to right side updates crop without any click
    fireEvent.mouseMove(stickerZone, { clientX: 200, clientY: 100 });

    // Submit MyInstants URL in bottom timeline bar
    const urlInput = screen.getByTestId("myinstants-url-input");
    fireEvent.change(urlInput, { target: { value: "https://www.myinstants.com/en/instant/test/" } });
    fireEvent.submit(urlInput.closest("form")!);

    await waitFor(() => expect(screen.getByTestId("duration-readout").textContent).toContain("10.0s / 10.0s"));
    expect(okArrowBtn.disabled).toBe(false);
    expect(downloadBtn.disabled).toBe(false);

    // Click Arrow (➔) -> generates most compatible preview & copies to clipboard without downloading
    fireEvent.click(okArrowBtn);
    await waitFor(() => expect(copyArtifactToClipboard).toHaveBeenCalledTimes(1));
    expect(copyArtifactToClipboard.mock.calls[0]![0].profile).toBe("video-mp4");
    expect(saveArtifact).not.toHaveBeenCalled();
    expect(screen.getByTestId("video-preview-ready")).toBeTruthy();

    // Click Download (⬇) -> opens format picker; pick High Quality / Transparent WebM
    fireEvent.click(downloadBtn);
    expect(screen.getByTestId("download-format-picker")).toBeTruthy();
    fireEvent.click(screen.getByTestId("download-fmt-video-webm-alpha"));
    await waitFor(() => expect(saveArtifact).toHaveBeenCalledTimes(1));
    expect(saveArtifact.mock.calls[0]![0].profile).toBe("video-webm-alpha");

    // Click X (✕) -> resets everything back to 0
    fireEvent.click(screen.getByTestId("reset-all-btn"));
    await waitFor(() => expect(screen.getByTestId("myinstants-url-input")).toBeTruthy());
    expect(okArrowBtn.disabled).toBe(true);
    expect(container.querySelector('[data-testid="sticker-loaded-badge"]')).toBeNull();
  });

  it("shows localized error banner when an invalid URL is submitted", async () => {
    const provider: SoundProvider = {
      id: "myinstants",
      canResolve: () => false,
      resolve: async () => {
        throw new StikSoundError("url-rejected");
      }
    };

    render(
      <StikSoundMinimalApp
        engine={createTestEngine()}
        providers={[provider]}
        shell={{ saveArtifact: vi.fn() }}
        initialLocale="es"
      />
    );

    const urlInput = screen.getByTestId("myinstants-url-input");
    fireEvent.change(urlInput, { target: { value: "https://evil.example/sound.mp3" } });
    fireEvent.submit(urlInput.closest("form")!);

    await waitFor(() => expect(screen.getByTestId("error-banner").textContent).toContain("MyInstants"));
  });
});
