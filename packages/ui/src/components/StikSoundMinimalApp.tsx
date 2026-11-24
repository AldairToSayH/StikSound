import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EXPORT_PROFILES,
  LIMITS,
  ProjectController,
  computeSquareCrop,
  createProject,
  formatError,
  resetProject,
  type ExportArtifact,
  type ExportProfileId,
  type LocaleCode,
  type MediaEngine,
  type ProjectWorkspaceState,
  type SoundProvider
} from "@stiksound/core";
import enLocale from "../locales/en.json";
import esLocale from "../locales/es.json";
import { Timeline5sBar } from "./Timeline5sBar";

export interface ShellBridge {
  saveArtifact(artifact: ExportArtifact): Promise<string | void>;
  copyArtifactToClipboard?(artifact: ExportArtifact): Promise<void>;
  saveProjectZip?(zipBytes: Uint8Array, suggestedName: string): Promise<void>;
  openProjectZip?(): Promise<Uint8Array | null>;
}

export interface StikSoundMinimalAppProps {
  engine: MediaEngine;
  providers?: SoundProvider[];
  shell: ShellBridge;
  initialLocale?: LocaleCode;
  initialState?: ProjectWorkspaceState;
}

const LOCALES = { es: esLocale, en: enLocale } as const;

export const StikSoundMinimalApp: React.FC<StikSoundMinimalAppProps> = ({
  engine,
  providers = [],
  shell,
  initialLocale = "es",
  initialState
}) => {
  const controller = useMemo(() => new ProjectController(engine, providers), [engine, providers]);
  const [locale, setLocale] = useState<LocaleCode>(initialLocale);
  const [project, setProject] = useState<ProjectWorkspaceState>(() => initialState ?? createProject());
  const [urlInput, setUrlInput] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [readyArtifact, setReadyArtifact] = useState<ExportArtifact | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const stickerFileInputRef = useRef<HTMLInputElement>(null);
  const projectZipInputRef = useRef<HTMLInputElement>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const playbackTimerRef = useRef<number | null>(null);

  const copy = LOCALES[locale];
  const sticker = project.manifest.stickers[0];
  const audio = project.manifest.audios[0];
  const assoc = project.manifest.associations[0];
  const activeProfile = project.manifest.export.profile;

  const stickerPreviewUrl = useMemo(() => {
    if (!sticker) return null;
    const bytes = project.assets.get(sticker.file);
    if (!bytes || typeof URL.createObjectURL !== "function") return null;
    const blob = new Blob([bytes.slice().buffer], { type: `image/${sticker.format}` });
    return URL.createObjectURL(blob);
  }, [sticker, project.assets]);

  const readyVideoUrl = useMemo(() => {
    if (!readyArtifact || typeof URL.createObjectURL !== "function") return null;
    const blob = new Blob([readyArtifact.bytes.slice().buffer], { type: readyArtifact.mimeType });
    return URL.createObjectURL(blob);
  }, [readyArtifact]);

  useEffect(() => {
    return () => {
      if (stickerPreviewUrl && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(stickerPreviewUrl);
      }
    };
  }, [stickerPreviewUrl]);

  useEffect(() => {
    return () => {
      if (readyVideoUrl && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(readyVideoUrl);
      }
    };
  }, [readyVideoUrl]);

  const stopPlayback = useCallback(() => {
    if (playbackTimerRef.current !== null) {
      window.clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.src = "";
      audioElRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  useEffect(() => stopPlayback, [stopPlayback]);

  const handleError = useCallback(
    (err: unknown) => {
      const localized = formatError(err, locale);
      setErrorMessage(`${localized.title} ${localized.action}`);
      setStatusMessage(null);
    },
    [locale]
  );

  const importStickerBytes = useCallback(
    async (bytes: Uint8Array, name: string) => {
      setIsBusy(true);
      setErrorMessage(null);
      setStatusMessage(null);
      setReadyArtifact(null);
      setDownloadMenuOpen(false);
      try {
        const next = await controller.importSticker(project, bytes, name);
        setProject(next);
      } catch (err) {
        handleError(err);
      } finally {
        setIsBusy(false);
      }
    },
    [controller, project, handleError]
  );

  const importAudioBytes = useCallback(
    async (bytes: Uint8Array, name: string) => {
      stopPlayback();
      setIsBusy(true);
      setErrorMessage(null);
      setStatusMessage(null);
      setReadyArtifact(null);
      setDownloadMenuOpen(false);
      try {
        const next = await controller.importAudioFile(project, bytes, name);
        setProject(next);
      } catch (err) {
        handleError(err);
      } finally {
        setIsBusy(false);
      }
    },
    [controller, project, handleError, stopPlayback]
  );

  const importMyInstantsUrl = useCallback(
    async (rawUrl: string) => {
      stopPlayback();
      setIsBusy(true);
      setErrorMessage(null);
      setStatusMessage(null);
      setReadyArtifact(null);
      setDownloadMenuOpen(false);
      try {
        const next = await controller.importAudioUrl(project, rawUrl);
        setProject(next);
        setUrlInput("");
      } catch (err) {
        handleError(err);
      } finally {
        setIsBusy(false);
      }
    },
    [controller, project, handleError, stopPlayback]
  );

  const handleGlobalPaste = useCallback(
    async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i]!;
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) {
              e.preventDefault();
              await importStickerBytes(new Uint8Array(await file.arrayBuffer()), file.name || "pasted.png");
              return;
            }
          }
        }
      }
      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (text && /^https?:\/\//i.test(text)) {
        e.preventDefault();
        setUrlInput(text);
        await importMyInstantsUrl(text);
      }
    },
    [importStickerBytes, importMyInstantsUrl]
  );

  useEffect(() => {
    window.addEventListener("paste", handleGlobalPaste);
    return () => window.removeEventListener("paste", handleGlobalPaste);
  }, [handleGlobalPaste]);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      stopPlayback();
      return;
    }
    if (!audio || !assoc) return;
    const bytes = project.assets.get(audio.file);
    if (!bytes || typeof Audio === "undefined" || typeof URL.createObjectURL !== "function") return;

    const blob = new Blob([bytes.slice().buffer], { type: `audio/${audio.format}` });
    const url = URL.createObjectURL(blob);
    const el = new Audio(url);
    el.currentTime = assoc.start_ms / 1000;
    audioElRef.current = el;
    setIsPlaying(true);

    const playDur = Math.max(100, assoc.end_ms - assoc.start_ms);
    playbackTimerRef.current = window.setTimeout(() => {
      URL.revokeObjectURL(url);
      stopPlayback();
    }, playDur);

    el.play().catch(() => {
      URL.revokeObjectURL(url);
      stopPlayback();
    });
  }, [isPlaying, stopPlayback, audio, assoc, project.assets]);

  const handleResetAll = () => {
    stopPlayback();
    setProject((prev) => resetProject(prev));
    setReadyArtifact(null);
    setDownloadMenuOpen(false);
    setMenuOpen(false);
    setUrlInput("");
    setErrorMessage(null);
    setStatusMessage(null);
  };

  const profileDef = EXPORT_PROFILES[activeProfile];
  const trimValid =
    !profileDef.requiresAudio ||
    (assoc !== undefined &&
      assoc.end_ms - assoc.start_ms >= LIMITS.MIN_TRIM_DURATION_MS &&
      assoc.end_ms - assoc.start_ms <= profileDef.maxAudioMs);
  const canExport = Boolean(sticker) && (!profileDef.requiresAudio || Boolean(audio)) && trimValid && !isBusy;

  let exportDisabledReason = copy.exportTooltip;
  if (!sticker) exportDisabledReason = copy.exportDisabledMissingSticker;
  else if (profileDef.requiresAudio && !audio) exportDisabledReason = copy.exportDisabledMissingAudio;
  else if (!trimValid) exportDisabledReason = copy.exportDisabledTrim;

  const copyArtifactNow = async (artifact: ExportArtifact) => {
    if (shell.copyArtifactToClipboard) {
      await shell.copyArtifactToClipboard(artifact);
      setStatusMessage(copy.copiedReadyToast);
      return;
    }
    if (typeof navigator !== "undefined" && navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      try {
        const blob = new Blob([artifact.bytes.slice().buffer], { type: artifact.mimeType });
        await navigator.clipboard.write([new ClipboardItem({ [artifact.mimeType]: blob })]);
      } catch {
        // Fallback if browser restricts video MIME in ClipboardItem
      }
    }
    setStatusMessage(copy.copiedReadyToast);
  };

  // Arrow (➔): generates the most compatible preview & copies to clipboard for WhatsApp sticker paste
  const handlePreviewAndCopyArrow = async () => {
    if (!canExport) return;
    stopPlayback();
    setDownloadMenuOpen(false);
    setMenuOpen(false);
    setIsBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const compatibleProfile: ExportProfileId =
        activeProfile === "video-webm-alpha" ? "video-webm-alpha" : "video-mp4";
      const artifact = readyArtifact ?? (await controller.exportProject(project, compatibleProfile));
      setReadyArtifact(artifact);
      await copyArtifactNow(artifact);
    } catch (err) {
      handleError(err);
    } finally {
      setIsBusy(false);
    }
  };

  // Download format selection (⬇): exports the chosen format & saves to disk
  const handleDownloadWithFormat = async (formatProfile: ExportProfileId) => {
    if (!sticker || isBusy) return;
    const def = EXPORT_PROFILES[formatProfile];
    if (def.requiresAudio && (!audio || !trimValid)) return;

    stopPlayback();
    setDownloadMenuOpen(false);
    setMenuOpen(false);
    setIsBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const artifact = await controller.exportProject(project, formatProfile);
      await shell.saveArtifact(artifact);
      setStatusMessage(
        artifact.profile === "sound-bundle" ? copy.exportSuccessBundle : copy.exportSuccessVideo
      );
    } catch (err) {
      handleError(err);
    } finally {
      setIsBusy(false);
    }
  };

  const handleRangeChange = (startMs: number, endMs: number) => {
    setReadyArtifact(null);
    try {
      setProject((prev) => controller.updateAudioEdit(prev, { start_ms: startMs, end_ms: endMs }));
      setErrorMessage(null);
    } catch (err) {
      handleError(err);
    }
  };

  const selectTransparentMode = () => {
    setReadyArtifact(null);
    setProject((prev) => controller.setExportProfile(prev, "video-webm-alpha"));
  };

  const selectSolidMatte = (hex: string) => {
    setReadyArtifact(null);
    setProject((prev) => {
      const withProfile = controller.setExportProfile(prev, "video-mp4");
      return controller.updateStickerEdit(withProfile, { matte_color: hex });
    });
  };

  // Zero-click hover cropping when image is not already 1:1
  const handleStageMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (!sticker || sticker.width === sticker.height) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setReadyArtifact(null);
    setProject((prev) =>
      controller.updateStickerEdit(prev, {
        crop_x: Number(nx.toFixed(3)),
        crop_y: Number(ny.toFixed(3))
      })
    );
  };

  const isTransparentSelected = activeProfile === "video-webm-alpha";
  const currentMatte = sticker?.edit.matte_color ?? LIMITS.DEFAULT_MATTE_COLOR;
  const cropX = sticker?.edit.crop_x ?? 0.5;
  const cropY = sticker?.edit.crop_y ?? 0.5;
  const squareMeta = sticker ? computeSquareCrop(sticker.width, sticker.height, cropX, cropY) : null;
  const stageBgStyle =
    sticker && !isTransparentSelected && (activeProfile === "video-mp4" || !sticker.has_alpha)
      ? { backgroundImage: "none", backgroundColor: currentMatte }
      : undefined;

  return (
    <div className="stik-shell" data-testid="stiksound-minimal-app">
      <header className="stik-top-corners">
        <button
          type="button"
          data-testid="reset-all-btn"
          className="stik-corner-btn stik-reset-btn"
          title={copy.resetTooltip}
          aria-label={copy.resetTooltip}
          onClick={handleResetAll}
        >
          ✕
        </button>

        <div className="stik-right-actions">
          <button
            type="button"
            data-testid="overflow-menu-btn"
            className="stik-corner-btn stik-menu-btn"
            aria-label="Menu"
            onClick={() => {
              setDownloadMenuOpen(false);
              setMenuOpen((o) => !o);
            }}
          >
            ⋯
          </button>

          <button
            type="button"
            data-testid="download-btn"
            className={`stik-corner-btn stik-download-btn ${sticker && !isBusy ? "ready" : "disabled"}`}
            disabled={!sticker || isBusy}
            title={sticker ? copy.downloadTooltip : exportDisabledReason}
            aria-label={copy.downloadTooltip}
            onClick={() => {
              setMenuOpen(false);
              setDownloadMenuOpen((o) => !o);
            }}
          >
            ⬇
          </button>

          <button
            type="button"
            data-testid="export-ok-btn"
            className={`stik-corner-btn stik-ok-btn ${canExport ? "ready" : "disabled"}`}
            disabled={!canExport}
            title={exportDisabledReason}
            aria-label={exportDisabledReason}
            onClick={handlePreviewAndCopyArrow}
          >
            {isBusy ? "…" : "➔"}
          </button>
        </div>
      </header>

      {downloadMenuOpen && sticker && (
        <div className="stik-popover" data-testid="download-format-picker">
          <div className="stik-popover-label">{copy.downloadChooseFormat}</div>
          <div className="stik-popover-actions">
            <button
              type="button"
              data-testid="download-fmt-video-mp4"
              disabled={!audio || !trimValid}
              onClick={() => handleDownloadWithFormat("video-mp4")}
            >
              {copy.downloadFmtMp4}
            </button>
            <button
              type="button"
              data-testid="download-fmt-video-webm-alpha"
              disabled={!audio || !trimValid}
              onClick={() => handleDownloadWithFormat("video-webm-alpha")}
            >
              {copy.downloadFmtWebm}
            </button>
            <button
              type="button"
              data-testid="download-fmt-sound-bundle"
              disabled={!audio || !trimValid}
              onClick={() => handleDownloadWithFormat("sound-bundle")}
            >
              {copy.downloadFmtBundle}
            </button>
            <button
              type="button"
              data-testid="download-fmt-standard-webp"
              onClick={() => handleDownloadWithFormat("standard-webp")}
            >
              {copy.downloadFmtWebp}
            </button>
          </div>
        </div>
      )}

      {menuOpen && (
        <div className="stik-popover" data-testid="overflow-menu">
          <div className="stik-popover-actions">
            <button
              type="button"
              onClick={async () => {
                setMenuOpen(false);
                if (shell.openProjectZip) {
                  const zipBytes = await shell.openProjectZip();
                  if (zipBytes) {
                    setReadyArtifact(null);
                    setProject(await controller.openProject(zipBytes));
                  }
                } else {
                  projectZipInputRef.current?.click();
                }
              }}
            >
              {copy.menuOpenProject}
            </button>
            <button
              type="button"
              onClick={async () => {
                setMenuOpen(false);
                try {
                  const zipBytes = await controller.saveProject(project);
                  if (shell.saveProjectZip) {
                    await shell.saveProjectZip(zipBytes, `${project.manifest.project.name}.stiksound.zip`);
                  }
                } catch (err) {
                  handleError(err);
                }
              }}
            >
              {copy.menuSaveProject}
            </button>
            <button type="button" onClick={() => setLocale((l) => (l === "es" ? "en" : "es"))}>
              {copy.menuLanguage}: {locale.toUpperCase()}
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setAboutOpen(true);
              }}
            >
              {copy.menuAbout}
            </button>
          </div>
        </div>
      )}

      <input
        ref={stickerFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
        style={{ display: "none" }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) await importStickerBytes(new Uint8Array(await f.arrayBuffer()), f.name);
          e.target.value = "";
        }}
      />
      <input
        ref={projectZipInputRef}
        type="file"
        accept=".zip,.stiksound.zip"
        style={{ display: "none" }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            try {
              setReadyArtifact(null);
              setProject(await controller.openProject(new Uint8Array(await f.arrayBuffer())));
            } catch (err) {
              handleError(err);
            }
          }
          e.target.value = "";
        }}
      />

      {readyArtifact ? (
        <main className="stik-preview-ready-card" data-testid="video-preview-ready">
          {readyVideoUrl ? (
            <video
              src={readyVideoUrl}
              controls
              autoPlay
              loop
              playsInline
              className="stik-ready-video"
            />
          ) : (
            <div className="stik-sticker-fallback">{readyArtifact.fileName}</div>
          )}
          <div className="stik-ready-actions">
            <button
              type="button"
              data-testid="copy-again-btn"
              className="stik-pill-btn stik-pill-accent"
              onClick={() => copyArtifactNow(readyArtifact)}
            >
              {copy.copyAgainBtn}
            </button>
            <button
              type="button"
              data-testid="preview-download-btn"
              className="stik-pill-btn"
              onClick={() => setDownloadMenuOpen((o) => !o)}
            >
              ⬇ {copy.downloadBtnLabel}
            </button>
            <button
              type="button"
              data-testid="back-to-edit-btn"
              className="stik-pill-btn"
              onClick={() => setReadyArtifact(null)}
            >
              {copy.backToEditBtn}
            </button>
          </div>
        </main>
      ) : (
        <main
          data-testid="sticker-zone"
          className={`stik-sticker-stage ${sticker ? "has-sticker" : "empty"}`}
          style={stageBgStyle}
          onMouseMove={handleStageMouseMove}
          onDragOver={(e) => e.preventDefault()}
          onDrop={async (e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (!f) return;
            if (f.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac)$/i.test(f.name)) {
              await importAudioBytes(new Uint8Array(await f.arrayBuffer()), f.name);
            } else {
              await importStickerBytes(new Uint8Array(await f.arrayBuffer()), f.name);
            }
          }}
          onClick={() => {
            if (!sticker) stickerFileInputRef.current?.click();
            else if (audio) togglePlay();
          }}
        >
          {!sticker ? (
            <div className="stik-empty-sticker">
              <div className="stik-plus-icon">+</div>
              <p className="stik-empty-title">{copy.stickerDropTitle}</p>
              <p className="stik-empty-hint">{copy.stickerDropHint}</p>
            </div>
          ) : (
            <div className="stik-preview-box">
              {stickerPreviewUrl ? (
                <img
                  src={stickerPreviewUrl}
                  alt={sticker.source_name}
                  className="stik-sticker-img"
                  style={{
                    objectFit: "cover",
                    objectPosition: `${Math.round(cropX * 100)}% ${Math.round(cropY * 100)}%`
                  }}
                />
              ) : (
                <div data-testid="sticker-loaded-badge" className="stik-sticker-fallback">
                  {sticker.source_name}
                </div>
              )}
              {squareMeta && (
                <span data-testid="resolution-pill" className="stik-res-badge">
                  1:1 · {squareMeta.outputSize}×{squareMeta.outputSize}
                  {sticker.width !== sticker.height ? ` · ${copy.hoverCropHint}` : ""}
                </span>
              )}
              {audio && (
                <span className="stik-speaker-badge" aria-label="Audio attached">
                  🔊
                </span>
              )}
            </div>
          )}
        </main>
      )}

      {!readyArtifact && sticker && sticker.has_alpha && (
        <div className="stik-transparency-bar" data-testid="transparency-picker">
          <span className="stik-trans-label">{copy.transparencyLabel}</span>
          <button
            type="button"
            data-testid="matte-transparent-btn"
            className={`stik-trans-chip ${isTransparentSelected ? "active" : ""}`}
            onClick={selectTransparentMode}
          >
            {copy.modeTransparent}
          </button>
          <button
            type="button"
            data-testid="matte-white-btn"
            className={`stik-trans-chip ${!isTransparentSelected && currentMatte === "#FFFFFF" ? "active" : ""}`}
            onClick={() => selectSolidMatte("#FFFFFF")}
          >
            {copy.modeWhite}
          </button>
          <button
            type="button"
            data-testid="matte-black-btn"
            className={`stik-trans-chip ${!isTransparentSelected && currentMatte === "#000000" ? "active" : ""}`}
            onClick={() => selectSolidMatte("#000000")}
          >
            {copy.modeBlack}
          </button>
          <label className="stik-color-chip" title={copy.modeCustom}>
            <input
              type="color"
              data-testid="matte-custom-input"
              value={currentMatte}
              onChange={(e) => selectSolidMatte(e.target.value.toUpperCase())}
            />
          </label>
        </div>
      )}

      {(errorMessage || statusMessage) && (
        <div
          data-testid={errorMessage ? "error-banner" : "status-banner"}
          className={`stik-toast ${errorMessage ? "error" : "success"}`}
        >
          {errorMessage ?? statusMessage}
        </div>
      )}

      <Timeline5sBar
        hasAudio={Boolean(audio)}
        durationMs={audio?.duration_ms ?? 0}
        startMs={assoc?.start_ms ?? 0}
        endMs={assoc?.end_ms ?? 0}
        maxWindowMs={profileDef.maxAudioMs}
        peaks={project.waveformPeaks}
        isPlaying={isPlaying}
        isBusy={isBusy}
        urlInput={urlInput}
        onUrlInputChange={setUrlInput}
        onSubmitUrl={importMyInstantsUrl}
        onSelectAudioFile={async (f) => importAudioBytes(new Uint8Array(await f.arrayBuffer()), f.name)}
        onChangeRange={handleRangeChange}
        onTogglePlay={togglePlay}
        labels={{
          placeholder: copy.audioInputPlaceholder,
          pickBtn: copy.audioPickBtn,
          play: copy.playPreview,
          stop: copy.stopPreview
        }}
      />

      {aboutOpen && (
        <div className="stik-modal-backdrop" onClick={() => setAboutOpen(false)}>
          <div className="stik-modal" onClick={(e) => e.stopPropagation()}>
            <h3>StikSound v1.0</h3>
            <p>{copy.aboutRights}</p>
            <button type="button" onClick={() => setAboutOpen(false)}>
              {copy.close}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
