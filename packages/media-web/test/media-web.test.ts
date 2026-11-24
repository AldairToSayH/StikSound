import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import {
  WebMediaEngine,
  compositeRgbaOnMatte,
  cropAndFitSquareRgba,
  encodeWavBytes,
  scheduleGifFramesForDuration,
  sniffImageHeader,
  trimPcmSamples
} from "../src/index";

function makeMinimalPngHeader(w: number, h: number, colorType = 6): Uint8Array {
  const buf = new Uint8Array(33);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(buf.buffer);
  view.setUint32(8, 13, false);
  buf.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, w, false);
  view.setUint32(20, h, false);
  buf[24] = 8;
  buf[25] = colorType;
  return buf;
}

function makeAnimatedGifBytes(): Uint8Array {
  // GIF89a 2x2 with 2 frames, transparency flag on, delay 50cs (500ms) each
  return new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
    0x02, 0x00, 0x02, 0x00, 0x80, 0x00, 0x00, // 2x2, GCT 2 colors
    0x00, 0x00, 0x00, 0xff, 0x00, 0x00, // palette
    // Frame 1 GCE
    0x21, 0xf9, 0x04, 0x01, 0x32, 0x00, 0x00, 0x00,
    // Image descriptor 1
    0x2c, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00,
    // Frame 2 GCE
    0x21, 0xf9, 0x04, 0x01, 0x32, 0x00, 0x00, 0x00,
    // Image descriptor 2
    0x2c, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00,
    0x3b
  ]);
}

describe("packages/media-web", () => {
  it("sniffs PNG alpha, animated GIF frames, and rejects 40MP decompression bombs (SEC-009)", () => {
    const png = sniffImageHeader(makeMinimalPngHeader(400, 300, 6));
    expect(png).toEqual({
      format: "png",
      width: 400,
      height: 300,
      has_alpha: true,
      animated: false,
      frame_count: 1,
      duration_ms: 0
    });

    const gif = sniffImageHeader(makeAnimatedGifBytes());
    expect(gif.format).toBe("gif");
    expect(gif.animated).toBe(true);
    expect(gif.has_alpha).toBe(true);
    expect(gif.frame_count).toBe(2);
    expect(gif.duration_ms).toBe(1000);

    expect(() => sniffImageHeader(makeMinimalPngHeader(9000, 9000, 6))).toThrowError(/file-too-large/);
  });

  it("preserves alpha during 1:1 input-driven crop and cleanly composites onto matte", () => {
    const src = new Uint8Array(8 * 4 * 4);
    // Left half (x 0..3) red, right half (x 4..7) transparent
    for (let y = 1; y <= 2; y++) {
      for (let x = 1; x <= 2; x++) {
        const i = (y * 8 + x) * 4;
        src[i] = 255;
        src[i + 3] = 255;
      }
    }
    // cropX = 0 picks the left 4x4 square -> output is 4x4 (never upscaled)
    const leftSquare = cropAndFitSquareRgba(src, 8, 4, 0, 0.5);
    expect(leftSquare.width).toBe(4);
    expect(leftSquare.height).toBe(4);
    expect(leftSquare.data[3]).toBe(0); // corner transparent
    const centerIdx = (1 * 4 + 1) * 4;
    expect(leftSquare.data[centerIdx]).toBe(255);
    expect(leftSquare.data[centerIdx + 3]).toBe(255);

    const matted = compositeRgbaOnMatte(leftSquare, "#FFFFFF");
    expect(matted[0]).toBe(255);
    expect(matted[1]).toBe(255);
    expect(matted[2]).toBe(255);
    expect(matted[3]).toBe(255);
  });

  it("schedules looping GIF frames across exact 5-second video duration", () => {
    const schedule = scheduleGifFramesForDuration(
      [
        { frameIndex: 0, delayMs: 500 },
        { frameIndex: 1, delayMs: 500 }
      ],
      5000
    );
    expect(schedule).toHaveLength(10);
    const totalUs = schedule.reduce((sum, s) => sum + s.durationUs, 0);
    expect(totalUs).toBe(5_000_000);
  });

  it("trims WAV audio within 50 ms tolerance and rejects Zip-Slip (SEC-006)", async () => {
    const samples = new Float32Array(48000 * 7).fill(0.25);
    const wav = encodeWavBytes({ sampleRate: 48000, channels: 1, samples, durationMs: 7000 });
    const engine = new WebMediaEngine();

    const probe = await engine.probeAudio(wav);
    expect(probe.format).toBe("wav");
    expect(probe.duration_ms).toBe(7000);

    const peaks = await engine.waveform(wav);
    expect(peaks.buckets).toBe(1024);

    const trimmed = trimPcmSamples(samples, 48000, 1000, 4200, 1);
    expect(Math.abs(trimmed.durationMs - 3200)).toBeLessThanOrEqual(50);

    const evilZip = zipSync({ "../outside.txt": new Uint8Array([1, 2, 3]) });
    await expect(engine.unzip(evilZip)).rejects.toMatchObject({ code: "package-invalid" });
  });

  it("TC-018: reports unsupported-codec when WebCodecs is absent without writing files", async () => {
    const engine = new WebMediaEngine();
    await expect(
      engine.renderVideo({
        stickerBytes: makeMinimalPngHeader(64, 64),
        stickerFormat: "png",
        animated: false,
        audioBytes: new Uint8Array(100),
        audioFormat: "wav",
        startMs: 0,
        endMs: 3000,
        volume: 1,
        matteColor: "#FFFFFF",
        container: "mp4"
      })
    ).rejects.toMatchObject({ code: "unsupported-codec" });
  });
});
