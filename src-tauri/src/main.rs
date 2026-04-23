// main.rs — entry point for the Tauri desktop app
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    spherical_separator_lib::run();
}
