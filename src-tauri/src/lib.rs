// lib.rs — Tauri app library entry point
mod video;
mod reproject;
mod export;

pub use video::*;
pub use export::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            export::open_video,
            export::get_frame,
            export::export_fovs,
            export::get_camera_preview,
            export::get_all_camera_previews,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
