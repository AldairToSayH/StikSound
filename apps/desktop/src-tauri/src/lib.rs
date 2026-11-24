use std::fs;
use std::path::PathBuf;

use stiksound_audio_engine::{probe_audio, AudioProbeInfo};
use stiksound_image_engine::{probe_image, ImageProbeInfo};
use stiksound_project_store::atomic_publish_file;
use stiksound_video_engine::{run_ffmpeg_mux, VideoContainerProfile, VideoMuxRequest};

#[tauri::command]
fn cmd_probe_image(bytes: Vec<u8>) -> Result<ImageProbeInfo, String> {
    probe_image(&bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_probe_audio(bytes: Vec<u8>) -> Result<AudioProbeInfo, String> {
    probe_audio(&bytes).map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn cmd_render_video_5s(
    app: tauri::AppHandle,
    sticker_bytes: Vec<u8>,
    sticker_format: String,
    animated: bool,
    audio_bytes: Vec<u8>,
    audio_format: String,
    start_ms: u32,
    end_ms: u32,
    matte_color: String,
    container: String,
) -> Result<Vec<u8>, String> {
    use tauri::Manager;
    let base_temp = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("work");
    let export_temp = base_temp.join("export_tmp");
    let assets_dir = base_temp.join("assets");
    fs::create_dir_all(&assets_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&export_temp).map_err(|e| e.to_string())?;

    let sticker_path = assets_dir.join(format!("sticker.{sticker_format}"));
    let audio_path = assets_dir.join(format!("audio.{audio_format}"));
    let ext = if container == "webm-alpha" { "webm" } else { "mp4" };
    let output_path = export_temp.join(format!("out.{ext}"));

    fs::write(&sticker_path, &sticker_bytes).map_err(|e| e.to_string())?;
    fs::write(&audio_path, &audio_bytes).map_err(|e| e.to_string())?;

    let profile = if container == "webm-alpha" {
        VideoContainerProfile::VideoWebmAlpha
    } else {
        VideoContainerProfile::VideoMp4
    };

    let req = VideoMuxRequest {
        project_dir: base_temp.clone(),
        temp_dir: export_temp.clone(),
        sticker_path,
        sticker_animated_gif: animated && sticker_format == "gif",
        audio_path,
        output_path: output_path.clone(),
        start_ms,
        end_ms,
        matte_color_hex: matte_color,
        profile,
    };

    let ffmpeg_bin = PathBuf::from("ffmpeg");
    run_ffmpeg_mux(&ffmpeg_bin, &req).map_err(|e| e.to_string())?;
    let out = fs::read(&output_path).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(&export_temp);
    Ok(out)
}

#[tauri::command]
fn cmd_save_export_to_downloads(
    app: tauri::AppHandle,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    use tauri::Manager;
    let safe_name = PathBuf::from(&file_name)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid file name".to_string())?
        .to_string();

    let downloads_dir = app
        .path()
        .download_dir()
        .map_err(|e| e.to_string())?
        .join("StikSound");
    let dest = downloads_dir.join(&safe_name);
    atomic_publish_file(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
fn cmd_copy_artifact_to_clipboard(file_name: String, bytes: Vec<u8>) -> Result<String, String> {
    let raw_name = PathBuf::from(&file_name)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid file name".to_string())?
        .to_string();
    let safe_name: String = raw_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if safe_name.is_empty() {
        return Err("Empty sanitized file name".to_string());
    }

    let clipboard_dir = std::env::temp_dir().join("StikSoundClipboard");
    let dest = clipboard_dir.join(&safe_name);
    atomic_publish_file(&dest, &bytes).map_err(|e| e.to_string())?;
    let dest_str = dest.to_string_lossy().into_owned();

    #[cfg(target_os = "windows")]
    {
        let escaped = dest_str.replace('\'', "''");
        let ps_script = format!("Set-Clipboard -LiteralPath '{escaped}'");
        let status = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
            .status()
            .map_err(|e| format!("Clipboard command failed: {e}"))?;
        if !status.success() {
            return Err("Failed to copy file to Windows clipboard".to_string());
        }
    }

    #[cfg(target_os = "macos")]
    {
        let escaped = dest_str.replace('\\', "\\\\").replace('"', "\\\"");
        let osa_script = format!("set the clipboard to (POSIX file \"{escaped}\")");
        let status = std::process::Command::new("osascript")
            .args(["-e", &osa_script])
            .status()
            .map_err(|e| format!("Clipboard command failed: {e}"))?;
        if !status.success() {
            return Err("Failed to copy file to macOS clipboard".to_string());
        }
    }

    Ok(dest_str)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            cmd_probe_image,
            cmd_probe_audio,
            cmd_render_video_5s,
            cmd_save_export_to_downloads,
            cmd_copy_artifact_to_clipboard
        ])
        .run(tauri::generate_context!())
        .expect("error while running StikSound desktop application");
}
