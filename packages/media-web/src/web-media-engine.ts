import {
  LIMITS,
  StikSoundError,
  assertSafeZipEntryPath,
  computeSquareCrop,
  type AudioProbeInfo,
  type ImageProbeInfo,
  type MediaEngine,
  type PcmMono48k,
  type PeakBuckets,
  type RgbaFrame512,
  type StickerEdit,
  type VideoRenderRequest,
  type VideoRenderResult,
  type ZipEntryInput
} from "@stiksound/core";
import { unzipSync, zipSync } from "fflate";
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from "mp4-muxer";
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from "webm-muxer";
import { computePeaksFromFloat32, decodeWavToMonoFloat32, encodeWavBytes, trimPcmSamples } from "./audio-utils";
import { scheduleGifFramesForDuration } from "./gif-scheduler";
import { compositeRgbaOnMatte, cropAndFitSquareRgba } from "./image-utils";
import { sniffAudioContainer, sniffImageHeader } from "./sniffers";

export class WebMediaEngine implements MediaEngine {
  public async probeImage(bytes: Uint8Array): Promise<ImageProbeInfo> {
    return sniffImageHeader(bytes);
  }

  public async renderSticker(bytes: Uint8Array, edit: StickerEdit): Promise<RgbaFrame512> {
    const info = sniffImageHeader(bytes);
    const crop = computeSquareCrop(info.width, info.height, edit.crop_x ?? 0.5, edit.crop_y ?? 0.5);

    if (typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap !== "undefined") {
      const mime = `image/${info.format}`;
      const blob = new Blob([bytes.slice().buffer], { type: mime });
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(crop.outputSize, crop.outputSize);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new StikSoundError("encode-failed", "2D context unavailable.");
      ctx.clearRect(0, 0, crop.outputSize, crop.outputSize);
      ctx.drawImage(
        bitmap,
        crop.srcX,
        crop.srcY,
        crop.cropSide,
        crop.cropSide,
        0,
        0,
        crop.outputSize,
        crop.outputSize
      );
      bitmap.close();
      const imageData = ctx.getImageData(0, 0, crop.outputSize, crop.outputSize);
      return { width: crop.outputSize, height: crop.outputSize, data: new Uint8Array(imageData.data) };
    }

    // Headless/non-DOM fallback for unit tests
    return cropAndFitSquareRgba(
      new Uint8Array(info.width * info.height * 4),
      info.width,
      info.height,
      edit.crop_x ?? 0.5,
      edit.crop_y ?? 0.5
    );
  }

  public async encodeWebp(frame: RgbaFrame512): Promise<Uint8Array> {
    if (typeof OffscreenCanvas === "undefined") {
      throw new StikSoundError("unsupported-codec", "WebP canvas encoder requires browser OffscreenCanvas.");
    }
    const canvas = new OffscreenCanvas(frame.width, frame.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new StikSoundError("encode-failed", "2D context unavailable.");
    const imgData = new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height);
    ctx.putImageData(imgData, 0, 0);

    for (const quality of [1.0, 0.9, 0.8, 0.7, 0.6, 0.5]) {
      const blob = await canvas.convertToBlob({ type: "image/webp", quality });
      const arr = new Uint8Array(await blob.arrayBuffer());
      if (arr.byteLength <= LIMITS.MAX_STATIC_WEBP_BYTES) {
        return arr;
      }
    }
    throw new StikSoundError("sticker-too-large", "WebP exceeded 100 KB even at quality 50.");
  }

  public async probeAudio(bytes: Uint8Array): Promise<AudioProbeInfo> {
    const header = sniffAudioContainer(bytes);
    if (typeof AudioContext !== "undefined") {
      const ctx = new AudioContext();
      try {
        const copy = bytes.slice().buffer;
        const decoded = await ctx.decodeAudioData(copy);
        const durationMs = Math.round(decoded.duration * 1000);
        if (durationMs > LIMITS.MAX_AUDIO_DURATION_MS) {
          throw new StikSoundError("file-too-large", "Audio exceeds 3 minutes.");
        }
        return {
          format: header.format,
          duration_ms: durationMs,
          sample_rate: decoded.sampleRate,
          channels: decoded.numberOfChannels
        };
      } catch (err) {
        if (err instanceof StikSoundError) throw err;
        throw new StikSoundError("unsupported-audio", "Browser could not decode audio file.");
      } finally {
        await ctx.close().catch(() => undefined);
      }
    }
    return header;
  }

  private async decodeToMonoSamples(bytes: Uint8Array): Promise<{ samples: Float32Array; sampleRate: number }> {
    const info = sniffAudioContainer(bytes);
    if (typeof AudioContext !== "undefined") {
      const ctx = new AudioContext();
      try {
        const decoded = await ctx.decodeAudioData(bytes.slice().buffer);
        const mono = new Float32Array(decoded.length);
        for (let c = 0; c < decoded.numberOfChannels; c++) {
          const ch = decoded.getChannelData(c);
          for (let i = 0; i < decoded.length; i++) {
            mono[i] = (mono[i] ?? 0) + ch[i]! / decoded.numberOfChannels;
          }
        }
        return { samples: mono, sampleRate: decoded.sampleRate };
      } catch {
        throw new StikSoundError("unsupported-audio", "Browser could not decode audio.");
      } finally {
        await ctx.close().catch(() => undefined);
      }
    }
    if (info.format === "wav") {
      return decodeWavToMonoFloat32(bytes);
    }
    throw new StikSoundError("unsupported-codec", "Audio decode requires browser Web Audio API.");
  }

  public async waveform(bytes: Uint8Array): Promise<PeakBuckets> {
    const { samples } = await this.decodeToMonoSamples(bytes);
    return computePeaksFromFloat32(samples, LIMITS.WAVEFORM_BUCKETS);
  }

  public async renderAudio(
    bytes: Uint8Array,
    edit: { start_ms: number; end_ms: number; volume: number }
  ): Promise<PcmMono48k> {
    const { samples, sampleRate } = await this.decodeToMonoSamples(bytes);
    return trimPcmSamples(samples, sampleRate, edit.start_ms, edit.end_ms, edit.volume);
  }

  public async encodeOpus(pcm: PcmMono48k): Promise<Uint8Array> {
    // Fallback WAV or WebCodecs Opus check
    if (typeof AudioEncoder === "undefined") {
      throw new StikSoundError("unsupported-codec", "WebCodecs AudioEncoder unavailable in this browser.");
    }
    return encodeWavBytes(pcm);
  }

  public async renderVideo(request: VideoRenderRequest): Promise<VideoRenderResult> {
    const durationMs = request.endMs - request.startMs;

    // 1) Primary zero-dependency path: WebCodecs + pure-TS mp4-muxer / webm-muxer
    if (
      typeof VideoEncoder !== "undefined" &&
      typeof AudioEncoder !== "undefined" &&
      typeof VideoFrame !== "undefined" &&
      typeof AudioData !== "undefined" &&
      typeof OffscreenCanvas !== "undefined"
    ) {
      const isWebm = request.container === "webm-alpha";
      const videoCodec = isWebm ? "vp09.00.10.08" : "avc1.42001E";
      const audioCodec = isWebm ? "opus" : "mp4a.40.2";

      const imgInfo = sniffImageHeader(request.stickerBytes);
      const crop = computeSquareCrop(imgInfo.width, imgInfo.height, request.cropX ?? 0.5, request.cropY ?? 0.5);

      try {
        const vSupport = await VideoEncoder.isConfigSupported({
          codec: videoCodec,
          width: crop.outputSize,
          height: crop.outputSize,
          framerate: 24
        });
        const aSupport = await AudioEncoder.isConfigSupported({
          codec: audioCodec,
          sampleRate: 48000,
          numberOfChannels: 1,
          bitrate: isWebm ? 64_000 : 128_000
        });

        if (vSupport.supported && aSupport.supported) {
          return await this.renderVideoWithWebCodecs(request, durationMs, videoCodec, audioCodec, crop.outputSize);
        }
      } catch {
        // Fall through to universal MediaRecorder fallback below
      }
    }

    // 2) Universal zero-dependency browser/WebView fallback: Canvas.captureStream + MediaRecorder
    if (typeof MediaRecorder !== "undefined" && typeof document !== "undefined") {
      return this.renderVideoWithMediaRecorder(request, durationMs);
    }

    throw new StikSoundError(
      "unsupported-codec",
      "WebCodecs and MediaRecorder are unavailable in this environment; open .stiksound.zip in the desktop app."
    );
  }

  private async renderVideoWithWebCodecs(
    request: VideoRenderRequest,
    durationMs: number,
    videoCodec: string,
    audioCodec: string,
    outputSize: number
  ): Promise<VideoRenderResult> {
    const pcm = await this.renderAudio(request.audioBytes, {
      start_ms: request.startMs,
      end_ms: request.endMs,
      volume: request.volume
    });

    const isWebm = request.container === "webm-alpha";
    const framesToRender = await this.decodeVideoFrames(request, durationMs, outputSize);

    const mp4Target = isWebm ? null : new Mp4Target();
    const webmTarget = isWebm ? new WebmTarget() : null;
    const mp4Muxer = mp4Target
      ? new Mp4Muxer({
          target: mp4Target,
          video: { codec: "avc", width: outputSize, height: outputSize },
          audio: { codec: "aac", sampleRate: 48000, numberOfChannels: 1 },
          fastStart: "in-memory"
        })
      : null;
    const webmMuxer = webmTarget
      ? new WebmMuxer({
          target: webmTarget,
          video: { codec: "V_VP9", width: outputSize, height: outputSize, alpha: true },
          audio: { codec: "A_OPUS", sampleRate: 48000, numberOfChannels: 1 }
        })
      : null;

    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        mp4Muxer?.addVideoChunk(chunk, meta);
        webmMuxer?.addVideoChunk(chunk, meta);
      },
      error: () => {}
    });
    videoEncoder.configure({
      codec: videoCodec,
      width: outputSize,
      height: outputSize,
      bitrate: 1_200_000,
      framerate: 24,
      ...(isWebm ? { alpha: "keep" as const } : {})
    });

    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        mp4Muxer?.addAudioChunk(chunk, meta);
        webmMuxer?.addAudioChunk(chunk, meta);
      },
      error: () => {}
    });
    audioEncoder.configure({
      codec: audioCodec,
      sampleRate: 48000,
      numberOfChannels: 1,
      bitrate: isWebm ? 64_000 : 128_000
    });

    for (let i = 0; i < framesToRender.length; i++) {
      const f = framesToRender[i]!;
      const vf = new VideoFrame(f.canvas, {
        timestamp: f.timestampUs,
        duration: f.durationUs
      });
      videoEncoder.encode(vf, { keyFrame: i === 0 || i % 24 === 0 });
      vf.close();
    }

    const audioData = new AudioData({
      format: "f32-planar",
      sampleRate: 48000,
      numberOfFrames: pcm.samples.length,
      numberOfChannels: 1,
      timestamp: 0,
      data: pcm.samples.slice()
    });
    audioEncoder.encode(audioData);
    audioData.close();

    await videoEncoder.flush();
    await audioEncoder.flush();
    videoEncoder.close();
    audioEncoder.close();

    if (mp4Muxer && mp4Target) {
      mp4Muxer.finalize();
      return {
        bytes: new Uint8Array(mp4Target.buffer),
        mimeType: "video/mp4",
        extension: "mp4",
        durationMs: pcm.durationMs,
        hasAlpha: false
      };
    }

    webmMuxer!.finalize();
    return {
      bytes: new Uint8Array(webmTarget!.buffer),
      mimeType: "video/webm",
      extension: "webm",
      durationMs: pcm.durationMs,
      hasAlpha: true
    };
  }

  private async renderVideoWithMediaRecorder(
    request: VideoRenderRequest,
    durationMs: number
  ): Promise<VideoRenderResult> {
    const pcm = await this.renderAudio(request.audioBytes, {
      start_ms: request.startMs,
      end_ms: request.endMs,
      volume: request.volume
    });

    const imgInfo = sniffImageHeader(request.stickerBytes);
    const crop = computeSquareCrop(imgInfo.width, imgInfo.height, request.cropX ?? 0.5, request.cropY ?? 0.5);
    const canvas = document.createElement("canvas");
    canvas.width = crop.outputSize;
    canvas.height = crop.outputSize;
    const ctx = canvas.getContext("2d");
    if (!ctx || typeof canvas.captureStream !== "function") {
      throw new StikSoundError("unsupported-codec", "Canvas captureStream is not available.");
    }

    const isWebm = request.container === "webm-alpha";
    const imgBlob = new Blob([request.stickerBytes.slice().buffer], { type: `image/${request.stickerFormat}` });
    const imgUrl = URL.createObjectURL(imgBlob);
    const imgEl = new Image();
    imgEl.src = imgUrl;
    await new Promise<void>((resolve, reject) => {
      imgEl.onload = () => resolve();
      imgEl.onerror = () => reject(new StikSoundError("unsupported-image", "Image load failed."));
    });

    const drawSticker = () => {
      if (isWebm) {
        ctx.clearRect(0, 0, crop.outputSize, crop.outputSize);
      } else {
        ctx.fillStyle = request.matteColor;
        ctx.fillRect(0, 0, crop.outputSize, crop.outputSize);
      }
      ctx.drawImage(
        imgEl,
        crop.srcX,
        crop.srcY,
        crop.cropSide,
        crop.cropSide,
        0,
        0,
        crop.outputSize,
        crop.outputSize
      );
    };
    drawSticker();

    const audioCtx = new AudioContext({ sampleRate: 48000 });
    const audioBuffer = audioCtx.createBuffer(1, pcm.samples.length, 48000);
    audioBuffer.copyToChannel(pcm.samples.slice(), 0);
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    const dest = audioCtx.createMediaStreamDestination();
    source.connect(dest);

    const videoStream = canvas.captureStream(15);
    const combined = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...dest.stream.getAudioTracks()
    ]);

    const preferredMime = isWebm
      ? ["video/webm;codecs=vp9,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m))
      : ["video/mp4", "video/webm;codecs=vp8,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
    if (!preferredMime) {
      URL.revokeObjectURL(imgUrl);
      await audioCtx.close().catch(() => undefined);
      throw new StikSoundError("unsupported-codec", "No supported MediaRecorder video mime type.");
    }

    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(combined, { mimeType: preferredMime });
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
    };

    const done = new Promise<Uint8Array>((resolve, reject) => {
      recorder.onstop = async () => {
        const outBlob = new Blob(chunks, { type: preferredMime });
        resolve(new Uint8Array(await outBlob.arrayBuffer()));
      };
      recorder.onerror = () => reject(new StikSoundError("encode-failed", "MediaRecorder failed."));
    });

    const intervalId = window.setInterval(drawSticker, 66);
    recorder.start();
    source.start();

    await new Promise((r) => setTimeout(r, durationMs));
    window.clearInterval(intervalId);
    source.stop();
    if (recorder.state !== "inactive") recorder.stop();

    const bytes = await done;
    URL.revokeObjectURL(imgUrl);
    await audioCtx.close().catch(() => undefined);

    const outIsMp4 = preferredMime.includes("mp4");
    return {
      bytes,
      mimeType: outIsMp4 ? "video/mp4" : "video/webm",
      extension: outIsMp4 ? "mp4" : "webm",
      durationMs: pcm.durationMs,
      hasAlpha: !outIsMp4 && isWebm
    };
  }

  private async decodeVideoFrames(
    request: VideoRenderRequest,
    durationMs: number,
    outputSize: number
  ): Promise<Array<{ canvas: OffscreenCanvas; timestampUs: number; durationUs: number }>> {
    const isWebm = request.container === "webm-alpha";
    const cropX = request.cropX ?? 0.5;
    const cropY = request.cropY ?? 0.5;

    const drawFrameOnCanvas = (rgba: Uint8Array, size: number): OffscreenCanvas => {
      const c = new OffscreenCanvas(size, size);
      const ctx = c.getContext("2d")!;
      const finalPixels = isWebm
        ? rgba
        : compositeRgbaOnMatte({ width: size, height: size, data: rgba }, request.matteColor);
      ctx.putImageData(new ImageData(new Uint8ClampedArray(finalPixels), size, size), 0, 0);
      return c;
    };

    if (request.animated && request.stickerFormat === "gif" && typeof ImageDecoder !== "undefined") {
      const decoder = new ImageDecoder({ data: request.stickerBytes, type: "image/gif" });
      await decoder.tracks.ready;
      const count = decoder.tracks.selectedTrack?.frameCount ?? 1;
      const decodedCanvases: OffscreenCanvas[] = [];
      const timings: Array<{ frameIndex: number; delayMs: number }> = [];

      for (let i = 0; i < count; i++) {
        const res = await decoder.decode({ frameIndex: i });
        const vf = res.image;
        const crop = computeSquareCrop(vf.displayWidth, vf.displayHeight, cropX, cropY);
        const c = new OffscreenCanvas(crop.outputSize, crop.outputSize);
        const ctx = c.getContext("2d")!;
        if (!isWebm) {
          ctx.fillStyle = request.matteColor;
          ctx.fillRect(0, 0, crop.outputSize, crop.outputSize);
        } else {
          ctx.clearRect(0, 0, crop.outputSize, crop.outputSize);
        }
        ctx.drawImage(
          vf,
          crop.srcX,
          crop.srcY,
          crop.cropSide,
          crop.cropSide,
          0,
          0,
          crop.outputSize,
          crop.outputSize
        );
        const delayMs = Math.max(20, Math.round((vf.duration ?? 100_000) / 1000));
        vf.close();
        decodedCanvases.push(c);
        timings.push({ frameIndex: i, delayMs });
      }
      decoder.close();

      const scheduled = scheduleGifFramesForDuration(timings, durationMs);
      return scheduled.map((s) => ({
        canvas: decodedCanvases[s.frameIndex]!,
        timestampUs: s.timestampUs,
        durationUs: s.durationUs
      }));
    }

    const staticFrame = await this.renderSticker(request.stickerBytes, {
      fit: "contain",
      offset_x: 0,
      offset_y: 0,
      scale: 1,
      stroke: "none",
      matte_color: request.matteColor,
      crop_x: cropX,
      crop_y: cropY
    });
    const canvas = drawFrameOnCanvas(staticFrame.data, outputSize);
    const fps = 10;
    const stepUs = 100_000;
    const totalUs = durationMs * 1000;
    const out: Array<{ canvas: OffscreenCanvas; timestampUs: number; durationUs: number }> = [];
    for (let t = 0; t < totalUs; t += stepUs) {
      out.push({ canvas, timestampUs: t, durationUs: Math.min(stepUs, totalUs - t) });
    }
    if (out.length === 0) {
      out.push({ canvas, timestampUs: 0, durationUs: 100_000 * (10 / fps) });
    }
    return out;
  }

  public async zip(entries: ZipEntryInput[]): Promise<Uint8Array> {
    if (entries.length > LIMITS.MAX_PACKAGE_FILES) {
      throw new StikSoundError("package-invalid", "Too many zip entries.");
    }
    const record: Record<string, Uint8Array> = {};
    for (const entry of entries) {
      assertSafeZipEntryPath(entry.path);
      record[entry.path] = entry.bytes;
    }
    return zipSync(record, { level: 6 });
  }

  public async unzip(zipBytes: Uint8Array): Promise<ZipEntryInput[]> {
    let raw: Record<string, Uint8Array>;
    try {
      raw = unzipSync(zipBytes);
    } catch {
      throw new StikSoundError("package-invalid", "Corrupt or unreadable ZIP archive.");
    }

    const keys = Object.keys(raw);
    if (keys.length > LIMITS.MAX_PACKAGE_FILES) {
      throw new StikSoundError("package-invalid", "ZIP exceeds 32 entry limit.");
    }

    let totalBytes = 0;
    const out: ZipEntryInput[] = [];
    for (const path of keys) {
      assertSafeZipEntryPath(path);
      const bytes = raw[path]!;
      totalBytes += bytes.byteLength;
      if (totalBytes > LIMITS.MAX_PACKAGE_BYTES) {
        throw new StikSoundError("package-invalid", "ZIP exceeds 100 MB uncompressed limit.");
      }
      out.push({ path, bytes });
    }
    return out;
  }
}
