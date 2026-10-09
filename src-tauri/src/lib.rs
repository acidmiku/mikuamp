mod dsp;
mod engine;
mod library;
mod resampler;
mod windows;
use dsp::EqSettings;
use engine::{Command, Engine, Snapshot};
use library::{ScanResult, Track};
use serde_json::Value;
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager, State};

struct AppState {
    engine: Arc<Engine>,
    library: Mutex<Vec<Track>>,
    data: PathBuf,
    import_lock: tokio_shim::ImportLock,
}
// A dedicated mutex is held only by blocking import jobs, never by the webview thread.
mod tokio_shim {
    pub type ImportLock = std::sync::Mutex<()>;
}
fn save_json(path: &std::path::Path, value: &impl serde::Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}
#[tauri::command]
fn get_library(state: State<AppState>) -> Vec<Track> {
    state.library.lock().unwrap().clone()
}
#[tauri::command]
fn get_snapshot(state: State<AppState>) -> Snapshot {
    state.engine.snapshot.lock().unwrap().clone()
}
#[tauri::command]
fn get_eq(state: State<AppState>) -> EqSettings {
    state.engine.eq.lock().unwrap().clone()
}
#[tauri::command]
fn set_eq(
    settings: EqSettings,
    state: State<AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    settings.validate()?;
    save_json(&state.data.join("equalizer.json"), &settings)?;
    *state.engine.eq.lock().unwrap() = settings.clone();
    let _ = app.emit("eq-changed", settings);
    Ok(())
}
#[tauri::command]
async fn import_paths(paths: Vec<String>, app: tauri::AppHandle) -> Result<ScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _guard = state.import_lock.lock().unwrap();
        let result = library::scan(paths);
        let mut library = state.library.lock().unwrap();
        for track in &result.tracks {
            if let Some(old) = library.iter_mut().find(|t| t.id == track.id) {
                *old = track.clone();
            } else {
                library.push(track.clone());
            }
        }
        save_json(&state.data.join("library.json"), &*library)?;
        let _ = app.emit("library-changed", ());
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn enqueue(
    ids: Vec<String>,
    replace: bool,
    at: Option<usize>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let tracks = {
        let library = state.library.lock().unwrap();
        ids.iter()
            .map(|id| {
                library
                    .iter()
                    .find(|t| &t.id == id)
                    .cloned()
                    .ok_or_else(|| "Track not found in library".to_string())
            })
            .collect::<Result<Vec<_>, _>>()?
    };
    let command = match at {
        Some(at) if !replace => Command::Insert(tracks, at),
        _ => Command::Queue(tracks, replace),
    };
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || engine.send(command))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn transport(
    action: String,
    value: Option<Value>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let command = match action.as_str() {
        "play" => Command::Play(value.as_ref().and_then(|v| v.as_u64()).map(|n| n as usize)),
        "pause" => Command::Pause,
        "stop" => Command::Stop,
        "next" => Command::Next,
        "previous" => Command::Previous,
        "seek" => Command::Seek(value.and_then(|v| v.as_f64()).ok_or("Invalid position")?),
        "volume" => Command::Volume(value.and_then(|v| v.as_f64()).ok_or("Invalid volume")? as f32),
        "shuffle" => Command::Shuffle(value.and_then(|v| v.as_bool()).ok_or("Invalid shuffle")?),
        "repeat" => Command::Repeat(
            value
                .and_then(|v| v.as_str().map(str::to_owned))
                .ok_or("Invalid repeat")?,
        ),
        "remove" => {
            Command::Remove(value.and_then(|v| v.as_u64()).ok_or("Invalid index")? as usize)
        }
        "move" => {
            let value = value.ok_or("Invalid move")?;
            let index = |key: &str| {
                value
                    .get(key)
                    .and_then(|n| n.as_u64())
                    .map(|n| n as usize)
                    .ok_or("Invalid move")
            };
            Command::Move(index("from")?, index("to")?)
        }
        "clear" => Command::Clear,
        "clearError" => Command::ClearError,
        _ => return Err("Unknown playback action".into()),
    };
    let engine = app.state::<AppState>().engine.clone();
    tauri::async_runtime::spawn_blocking(move || engine.send(command))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
fn export_playlist(path: String, state: State<AppState>) -> Result<(), String> {
    let s = state.engine.snapshot.lock().unwrap();
    let lib = state.library.lock().unwrap();
    let mut out = String::from("#EXTM3U\n");
    for id in &s.queue {
        if let Some(t) = lib.iter().find(|t| &t.id == id) {
            out.push_str(&format!(
                "#EXTINF:{},{} - {}\n{}\n",
                t.duration as u64,
                t.artist.replace(['\n', '\r'], " "),
                t.title.replace(['\n', '\r'], " "),
                t.path
            ));
        }
    }
    fs::write(path, out).map_err(|e| e.to_string())
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data = std::env::var_os("MIKUAMP_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            fs::create_dir_all(&data)?;
            let library: Vec<Track> = fs::read(data.join("library.json"))
                .ok()
                .and_then(|s| serde_json::from_slice(&s).ok())
                .unwrap_or_default();
            let eq = fs::read(data.join("equalizer.json"))
                .ok()
                .and_then(|s| serde_json::from_slice::<EqSettings>(&s).ok())
                .filter(|e| e.validate().is_ok())
                .unwrap_or_default();
            let engine = Arc::new(Engine::new(eq, &library, data.join("session.json")));
            app.manage(AppState {
                engine,
                library: Mutex::new(library),
                data: data.clone(),
                import_lock: Mutex::new(()),
            });
            windows::setup(app, data)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if window.label() == "main" {
                    if let Some(panels) = app.try_state::<windows::Panels>() {
                        panels.save();
                    }
                    app.exit(0);
                } else {
                    api.prevent_close();
                    let label = window.label().to_owned();
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = windows::set_panel_visible(label, false, app).await;
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_library,
            get_snapshot,
            get_eq,
            set_eq,
            import_paths,
            enqueue,
            transport,
            export_playlist,
            windows::get_panels,
            windows::set_panel_visible,
            windows::fit_panel
        ])
        .run(tauri::generate_context!())
        .expect("start MikuAmp");
}
