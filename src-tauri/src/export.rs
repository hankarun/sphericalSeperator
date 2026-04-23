// export.rs — Tauri commands exposed to the frontend
use crate::reproject::{reproject, VirtualCamera};
use crate::video::{decode_frame_at, video_meta, VideoMeta};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use image::imageops;
use std::collections::HashMap;
use std::io::Cursor;
use tauri::command;

/// Open a video file and return metadata.
#[command]
pub async fn open_video(path: String) -> Result<VideoMeta, String> {
    video_meta(&path).map_err(|e| e.to_string())
}

/// Decode a single frame at the given timestamp and return it as a
/// base64-encoded JPEG (downsampled to max 1920px wide for fast IPC).
/// Async so it runs on the thread pool and never blocks the IPC queue.
#[command]
pub async fn get_frame(path: String, timestamp_ms: u64) -> Result<String, String> {
    let img = decode_frame_at(&path, timestamp_ms).map_err(|e| e.to_string())?;

    const MAX_W: u32 = 1920;
    let img = if img.width() > MAX_W {
        let scale = MAX_W as f32 / img.width() as f32;
        let new_h = (img.height() as f32 * scale) as u32;
        imageops::resize(&img, MAX_W, new_h, imageops::FilterType::Triangle)
    } else {
        img
    };

    let mut buf = Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Jpeg)
        .map_err(|e| e.to_string())?;

    Ok(BASE64.encode(buf.into_inner()))
}

/// Export all virtual camera views across a frame range.
///
/// - `start_ms` / `end_ms`: range to export (inclusive)
/// - `frame_step`: export every Nth frame (1 = every frame, 2 = every other, …)
/// - `out_width` / `out_height`: global fallback resolution for cameras with 0
/// - `file_prefix`: optional prefix for output filenames (e.g. segment label)
/// - Output filenames: `{prefix}_{camName}_{frame:06}.png`
///
/// Returns the list of written file paths.
#[command]
pub async fn export_fovs(
    path: String,
    start_ms: u64,
    end_ms: u64,
    frame_step: u32,
    cameras: Vec<VirtualCamera>,
    out_width: u32,
    out_height: u32,
    output_dir: String,
    file_prefix: Option<String>,
) -> Result<Vec<String>, String> {
    // Read fps so we know the ms-per-frame interval
    let meta = video_meta(&path).map_err(|e| e.to_string())?;
    let fps = if meta.fps > 0.0 { meta.fps } else { 30.0 };
    let ms_per_frame = 1000.0 / fps;
    let step = (frame_step.max(1) as f64 * ms_per_frame) as u64;

    let effective_end = end_ms.min(meta.duration_ms);

    let mut written: Vec<String> = Vec::new();
    let mut ts = start_ms;
    let mut frame_number: u64 = 0;

    while ts <= effective_end {
        let src = decode_frame_at(&path, ts).map_err(|e| e.to_string())?;

        for cam in &cameras {
            let mut cam_with_res = cam.clone();
            if cam_with_res.out_width == 0 { cam_with_res.out_width = out_width; }
            if cam_with_res.out_height == 0 { cam_with_res.out_height = out_height; }

            let out_img = reproject(&src, &cam_with_res);

            let safe_name: String = cam.name
                .chars()
                .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
                .collect();

            let filename = if let Some(ref prefix) = file_prefix {
                format!("{}_{}_{:06}.png", prefix, safe_name, frame_number)
            } else {
                format!("camera_{}_{:06}.png", safe_name, frame_number)
            };
            let out_path = std::path::Path::new(&output_dir).join(&filename);

            out_img.save(&out_path)
                .map_err(|e| format!("Failed to save {}: {}", filename, e))?;

            written.push(out_path.to_string_lossy().to_string());
        }

        ts += step;
        frame_number += 1;
    }

    Ok(written)
}

/// Render a single camera preview in memory — async to avoid blocking IPC.
#[command]
pub async fn get_camera_preview(
    path: String,
    timestamp_ms: u64,
    camera: VirtualCamera,
    out_width: u32,
    out_height: u32,
    preview_width: u32,
    preview_height: u32,
) -> Result<String, String> {
    let src = decode_frame_at(&path, timestamp_ms).map_err(|e| e.to_string())?;

    let mut cam = camera;
    if cam.out_width == 0 { cam.out_width = out_width; }
    if cam.out_height == 0 { cam.out_height = out_height; }

    let full = reproject(&src, &cam);

    let thumb = imageops::resize(&full, preview_width, preview_height, imageops::FilterType::Triangle);

    let mut buf = Cursor::new(Vec::new());
    thumb.write_to(&mut buf, image::ImageFormat::Jpeg).map_err(|e| e.to_string())?;

    Ok(BASE64.encode(buf.into_inner()))
}

/// Render all camera previews in memory — async, returns map of camera_id → base64 JPEG.
#[command]
pub async fn get_all_camera_previews(
    path: String,
    timestamp_ms: u64,
    cameras: Vec<VirtualCamera>,
    preview_width: u32,
    preview_height: u32,
) -> Result<HashMap<String, String>, String> {
    let src = decode_frame_at(&path, timestamp_ms).map_err(|e| e.to_string())?;

    let mut results: HashMap<String, String> = HashMap::new();

    for cam in cameras.iter() {
        let mut cam = cam.clone();
        if cam.out_width == 0 { cam.out_width = 1280; }
        if cam.out_height == 0 { cam.out_height = 720; }

        let full = reproject(&src, &cam);
        let thumb = imageops::resize(&full, preview_width, preview_height, imageops::FilterType::Triangle);

        let mut buf = Cursor::new(Vec::new());
        thumb.write_to(&mut buf, image::ImageFormat::Jpeg).map_err(|e| e.to_string())?;

        results.insert(cam.id.clone(), BASE64.encode(buf.into_inner()));
    }

    Ok(results)
}
