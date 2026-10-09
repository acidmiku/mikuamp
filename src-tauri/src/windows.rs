//! Native panel geometry. Windows' own move loop supplies physical screen pixels;
//! modifying WM_MOVING keeps magnets responsive even while the WebView is busy.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// Every native window. Each must also be listed in capabilities/default.json,
/// or Tauri refuses its IPC (dragging, closing, playback polling).
const PANEL_LABELS: [&str; 6] = [
    "main",
    "equalizer",
    "playlist",
    "library",
    "visuals",
    "skins",
];

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}
impl Rect {
    fn right(self) -> i32 {
        self.x + self.width
    }
    fn bottom(self) -> i32 {
        self.y + self.height
    }
    fn offset(self, x: i32, y: i32) -> Self {
        Self {
            x: self.x + x,
            y: self.y + y,
            ..self
        }
    }
}
fn overlap(a: i32, b: i32, c: i32, d: i32) -> bool {
    a < d && c < b
}
fn drag_position(origin: Rect, anchor: (i32, i32), cursor: (i32, i32)) -> Rect {
    origin.offset(cursor.0 - anchor.0, cursor.1 - anchor.1)
}
fn packed_cursor(x: i32, y: i32) -> isize {
    ((x as i16 as u16 as u32) | ((y as i16 as u16 as u32) << 16)) as isize
}
fn touching(a: Rect, b: Rect) -> bool {
    ((a.right() - b.x).abs() <= 2 || (b.right() - a.x).abs() <= 2)
        && overlap(a.y, a.bottom(), b.y, b.bottom())
        || ((a.bottom() - b.y).abs() <= 2 || (b.bottom() - a.y).abs() <= 2)
            && overlap(a.x, a.right(), b.x, b.right())
}
fn connected(rects: &[(usize, Rect)], root: usize) -> HashSet<usize> {
    let mut group = HashSet::from([root]);
    loop {
        let before = group.len();
        for (id, r) in rects {
            if rects
                .iter()
                .any(|(other, s)| group.contains(other) && touching(*r, *s))
            {
                group.insert(*id);
            }
        }
        if group.len() == before {
            return group;
        }
    }
}
fn magnet(mut r: Rect, targets: &[Rect], area: Rect, distance: i32) -> Rect {
    let (mut dx, mut dy) = (distance + 1, distance + 1);
    let mut choose = |x: Option<i32>, y: Option<i32>| {
        if let Some(x) = x {
            if x.abs() < dx.abs() {
                dx = x;
            }
        }
        if let Some(y) = y {
            if y.abs() < dy.abs() {
                dy = y;
            }
        }
    };
    choose(Some(area.x - r.x), Some(area.y - r.y));
    choose(
        Some(area.right() - r.right()),
        Some(area.bottom() - r.bottom()),
    );
    for t in targets {
        if overlap(r.y, r.bottom(), t.y, t.bottom()) {
            choose(Some(t.right() - r.x), None);
            choose(Some(t.x - r.right()), None);
        }
        if overlap(r.x, r.right(), t.x, t.right()) {
            choose(None, Some(t.bottom() - r.y));
            choose(None, Some(t.y - r.bottom()));
        }
        if (r.y - t.bottom()).abs() <= distance || (r.bottom() - t.y).abs() <= distance {
            choose(Some(t.x - r.x), None);
            choose(Some(t.right() - r.right()), None);
        }
        if (r.x - t.right()).abs() <= distance || (r.right() - t.x).abs() <= distance {
            choose(None, Some(t.y - r.y));
            choose(None, Some(t.bottom() - r.bottom()));
        }
    }
    if dx.abs() <= distance {
        r.x += dx;
    }
    if dy.abs() <= distance {
        r.y += dy;
    }
    r
}

#[derive(Clone, Serialize, Deserialize)]
pub struct PanelState {
    pub label: String,
    pub visible: bool,
    pub rect: Rect,
    #[serde(skip)]
    handle: usize,
    #[serde(skip)]
    ready: bool,
}
#[derive(Clone)]
pub struct Panels {
    entries: Arc<Mutex<Vec<PanelState>>>,
    path: PathBuf,
}
impl Panels {
    fn snapshot(&self) -> Vec<PanelState> {
        let mut entries = self.entries.lock().unwrap().clone();
        for e in &mut entries {
            e.rect = native::rect(e.handle);
        }
        entries
    }
    pub fn save(&self) {
        let _ = crate::save_json(&self.path, &self.snapshot());
    }
    fn emit(&self, app: &tauri::AppHandle) {
        let _ = app.emit("panels-changed", self.snapshot());
    }
}

pub fn setup(app: &mut tauri::App, data: PathBuf) -> tauri::Result<()> {
    let main = app.get_webview_window("main").unwrap();
    let monitor = main.current_monitor()?.or(main.primary_monitor()?).unwrap();
    let area = monitor.work_area();
    let dpi = monitor.scale_factor();
    let w = (500. * dpi) as i32;
    let h = (414. * dpi) as i32;
    let eq_h = (230. * dpi) as i32;
    let pl_h =
        (area.size.height as i32 - h - eq_h - 20).clamp((170. * dpi) as i32, (260. * dpi) as i32);
    let x = area.position.x + (area.size.width as i32 - w) / 2;
    let y = area.position.y + 10;
    let path = data.join("windows.json");
    let saved: Vec<PanelState> = std::fs::read(&path)
        .ok()
        .and_then(|v| serde_json::from_slice(&v).ok())
        .unwrap_or_default();
    let panels = Panels {
        entries: Default::default(),
        path,
    };
    app.manage(panels.clone());
    let defaults = [
        (
            "main",
            "MikuAmp",
            Rect {
                x,
                y,
                width: w,
                height: h,
            },
            true,
        ),
        (
            "equalizer",
            "MikuAmp · Equalizer",
            Rect {
                x,
                y: y + h,
                width: w,
                height: eq_h,
            },
            true,
        ),
        (
            "playlist",
            "MikuAmp · Queue",
            Rect {
                x,
                y: y + h + eq_h,
                width: w,
                height: pl_h,
            },
            true,
        ),
        (
            "library",
            "MikuAmp · Library",
            Rect {
                x: x + 40,
                y: y + 40,
                width: (780. * dpi) as i32,
                height: (650. * dpi) as i32,
            },
            false,
        ),
        (
            "visuals",
            "MikuAmp · Visuals",
            Rect {
                x: x + 50,
                y: y + 50,
                width: (720. * dpi) as i32,
                height: (640. * dpi) as i32,
            },
            false,
        ),
        (
            "skins",
            "MikuAmp · Skins",
            Rect {
                x: x + 60,
                y: y + 60,
                width: (680. * dpi) as i32,
                height: (670. * dpi) as i32,
            },
            false,
        ),
    ];
    let monitors = main.available_monitors()?;
    for (label, title, default, visible) in defaults {
        debug_assert!(
            PANEL_LABELS.contains(&label),
            "{label} missing from PANEL_LABELS"
        );
        let old = saved.iter().find(|s| s.label == label);
        let mut r = old.map(|s| s.rect).unwrap_or(default);
        // A disconnected display must never strand a titlebar off screen.
        if !monitors.iter().any(|m| {
            let a = m.work_area();
            r.x >= a.position.x
                && r.x + 80 <= a.position.x + a.size.width as i32
                && r.y >= a.position.y
                && r.y + 30 <= a.position.y + a.size.height as i32
        }) {
            r = default;
        }
        let window = if label == "main" {
            main.clone()
        } else {
            WebviewWindowBuilder::new(
                app,
                label,
                WebviewUrl::App(format!("index.html?panel={label}").into()),
            )
            .owner(&main)?
            .title(title)
            .decorations(false)
            .shadow(false)
            .visible(false)
            .skip_taskbar(true)
            .resizable(label != "equalizer")
            .min_inner_size(
                if ["library", "skins", "visuals"].contains(&label) {
                    560.
                } else {
                    500.
                },
                if label == "playlist" {
                    130.
                } else if label == "equalizer" {
                    100.
                } else {
                    400.
                },
            )
            .build()?
        };
        window.set_position(tauri::PhysicalPosition::new(r.x, r.y))?;
        window.set_size(tauri::PhysicalSize::new(r.width as u32, r.height as u32))?;
        let handle = native::handle(&window)?;
        panels.entries.lock().unwrap().push(PanelState {
            label: label.into(),
            visible: label == "main" || old.map(|s| s.visible).unwrap_or(visible),
            rect: r,
            handle,
            ready: false,
        });
        native::install(handle, label == "main", panels.clone())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_panels(state: tauri::State<Panels>) -> Vec<PanelState> {
    state.snapshot()
}

#[tauri::command]
pub async fn set_panel_visible(
    label: String,
    visible: bool,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if label == "main" {
        return Err("Use the main window's close control to quit".into());
    }
    let w = app.get_webview_window(&label).ok_or("Unknown panel")?;
    let panels = app.state::<Panels>();
    {
        let mut entries = panels.entries.lock().unwrap();
        let e = entries
            .iter_mut()
            .find(|e| e.label == label)
            .ok_or("Unknown panel")?;
        e.visible = visible;
    }
    if visible {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
    } else {
        w.hide().map_err(|e| e.to_string())?;
    }
    panels.save();
    panels.emit(&app);
    Ok(())
}

#[tauri::command]
pub async fn fit_panel(
    window: tauri::WebviewWindow,
    width: Option<f64>,
    height: Option<f64>,
    scale: f64,
    pixel_ratio: f64,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if !(0.5..=3.).contains(&scale) || !(0.5..=8.).contains(&pixel_ratio) {
        return Err("Invalid UI scale".into());
    }
    let state = app.state::<Panels>().inner().clone();
    let label = window.label().to_owned();
    // Subclass callbacks and geometry changes share the native UI thread.
    app.run_on_main_thread(move || {
        let Some(entry) = state.snapshot().into_iter().find(|e| e.label == label) else {
            return;
        };
        let dpi = window.scale_factor().unwrap_or(1.);
        if let Some(height) = height.filter(|h| h.is_finite() && *h > 20. && *h < 2000.) {
            // The main window narrows to the mini player; panels keep the classic width.
            let base = width
                .filter(|w| (240. ..=1000.).contains(w))
                .unwrap_or(500.);
            let width = (base * scale * dpi).round() as i32;
            let height = (height * pixel_ratio).ceil() as i32;
            native::resize(&state, entry.handle, width, height);
        }
        let visible = {
            let mut es = state.entries.lock().unwrap();
            let e = es.iter_mut().find(|e| e.label == label).unwrap();
            e.ready = true;
            e.visible
        };
        if visible {
            let _ = window.show();
        }
        state.save();
    })
    .map_err(|e| e.to_string())
}

#[cfg(windows)]
mod native {
    use super::*;
    use std::{cell::RefCell, ptr::null_mut};
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
        Graphics::Gdi::{GetMonitorInfoW, MonitorFromRect, MONITORINFO, MONITOR_DEFAULTTONEAREST},
        UI::{
            HiDpi::GetDpiForWindow,
            Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::*,
        },
    };
    #[derive(Clone)]
    struct Drag {
        origin: Rect,
        anchor: (i32, i32),
        panels: Vec<(usize, Rect)>,
    }
    struct Hook {
        main: bool,
        panels: Panels,
        drag: RefCell<Option<Drag>>,
    }
    pub fn handle(w: &tauri::WebviewWindow) -> tauri::Result<usize> {
        Ok(w.hwnd()?.0 as usize)
    }
    pub fn rect(handle: usize) -> Rect {
        unsafe {
            let mut r = RECT::default();
            GetWindowRect(handle as HWND, &mut r);
            Rect {
                x: r.left,
                y: r.top,
                width: r.right - r.left,
                height: r.bottom - r.top,
            }
        }
    }
    fn place(handle: usize, r: Rect, resize: bool) {
        unsafe {
            SetWindowPos(
                handle as HWND,
                null_mut(),
                r.x,
                r.y,
                r.width,
                r.height,
                SWP_NOACTIVATE | SWP_NOZORDER | if resize { 0 } else { SWP_NOSIZE },
            );
        }
    }
    fn area(r: Rect) -> Rect {
        unsafe {
            let bounds = RECT {
                left: r.x,
                top: r.y,
                right: r.right(),
                bottom: r.bottom(),
            };
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            GetMonitorInfoW(
                MonitorFromRect(&bounds, MONITOR_DEFAULTTONEAREST),
                &mut info,
            );
            let a = info.rcWork;
            Rect {
                x: a.left,
                y: a.top,
                width: a.right - a.left,
                height: a.bottom - a.top,
            }
        }
    }
    pub fn resize(panels: &Panels, handle: usize, width: i32, height: i32) {
        let old = rect(handle);
        if old.width == width && old.height == height {
            return;
        }
        let rects: Vec<_> = panels
            .snapshot()
            .iter()
            .filter(|e| e.visible && e.handle != handle)
            .map(|e| (e.handle, e.rect))
            .collect();
        let mut moved = HashSet::new();
        // Keep the panels hanging below/right attached when content or UI scale changes.
        for (id, r) in &rects {
            let (dx, dy) =
                if (r.y - old.bottom()).abs() <= 2 && overlap(r.x, r.right(), old.x, old.right()) {
                    (0, height - old.height)
                } else if (r.x - old.right()).abs() <= 2
                    && overlap(r.y, r.bottom(), old.y, old.bottom())
                {
                    (width - old.width, 0)
                } else {
                    continue;
                };
            for (next, bounds) in &rects {
                if connected(&rects, *id).contains(next) && moved.insert(*next) {
                    place(*next, bounds.offset(dx, dy), false);
                }
            }
        }
        place(
            handle,
            Rect {
                width,
                height,
                ..old
            },
            true,
        );
    }
    pub fn install(handle: usize, main: bool, panels: Panels) -> tauri::Result<()> {
        let data = Box::into_raw(Box::new(Hook {
            main,
            panels,
            drag: RefCell::new(None),
        }));
        if unsafe { SetWindowSubclass(handle as HWND, Some(procedure), 0x394d, data as usize) } == 0
        {
            unsafe {
                drop(Box::from_raw(data));
            }
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(())
    }
    unsafe extern "system" fn procedure(
        hwnd: HWND,
        msg: u32,
        w: WPARAM,
        l: LPARAM,
        id: usize,
        data: usize,
    ) -> LRESULT {
        let hook = &*(data as *const Hook);
        match msg {
            WM_NCLBUTTONDOWN if w == HTCAPTION as usize => {
                // tao 0.37.1's start_dragging posts a pointer to POINTS here,
                // but WM_NCLBUTTONDOWN requires the coordinates packed by value.
                // Normalize at our HWND boundary; never dereference that pointer.
                let mut cursor = POINT::default();
                if GetCursorPos(&mut cursor) != 0 {
                    return DefSubclassProc(hwnd, msg, w, packed_cursor(cursor.x, cursor.y));
                }
            }
            WM_ENTERSIZEMOVE => {
                let rects: Vec<_> = hook
                    .panels
                    .snapshot()
                    .into_iter()
                    .filter(|e| e.visible)
                    .map(|e| (e.handle, e.rect))
                    .collect();
                let group = if hook.main {
                    connected(&rects, hwnd as usize)
                } else {
                    HashSet::from([hwnd as usize])
                };
                let mut cursor = POINT::default();
                if GetCursorPos(&mut cursor) != 0 {
                    *hook.drag.borrow_mut() = Some(Drag {
                        origin: rect(hwnd as usize),
                        anchor: (cursor.x, cursor.y),
                        panels: rects
                            .into_iter()
                            .filter(|(id, _)| group.contains(id))
                            .collect(),
                    });
                }
            }
            WM_MOVING => {
                let raw = &mut *(l as *mut RECT);
                let Some(drag) = hook.drag.borrow().clone() else {
                    return DefSubclassProc(hwnd, msg, w, l);
                };
                let mut cursor = POINT::default();
                if GetCursorPos(&mut cursor) == 0 {
                    return DefSubclassProc(hwnd, msg, w, l);
                }
                // WM_MOVING can feed back the previous snapped rectangle. Anchor
                // every frame to the original mouse position so tiny movements
                // accumulate and can escape the magnet's threshold.
                let r = Rect {
                    width: raw.right - raw.left,
                    height: raw.bottom - raw.top,
                    ..drag_position(drag.origin, drag.anchor, (cursor.x, cursor.y))
                };
                let targets: Vec<_> = hook
                    .panels
                    .snapshot()
                    .into_iter()
                    .filter(|e| e.visible && !drag.panels.iter().any(|(id, _)| *id == e.handle))
                    .map(|e| e.rect)
                    .collect();
                let snapped = magnet(
                    r,
                    &targets,
                    area(r),
                    (12. * GetDpiForWindow(hwnd) as f64 / 96.).round() as i32,
                );
                raw.left = snapped.x;
                raw.top = snapped.y;
                raw.right = snapped.right();
                raw.bottom = snapped.bottom();
                for (id, bounds) in drag.panels {
                    if id != hwnd as usize {
                        place(
                            id,
                            bounds.offset(snapped.x - drag.origin.x, snapped.y - drag.origin.y),
                            false,
                        );
                    }
                }
                return 1;
            }
            WM_EXITSIZEMOVE => {
                let drag = hook.drag.borrow_mut().take();
                if let Some(drag) = drag {
                    // Windows can restore the starting position on Escape.
                    // Reconcile followers with the final native position too.
                    let final_rect = rect(hwnd as usize);
                    for (id, bounds) in drag.panels {
                        if id != hwnd as usize {
                            place(
                                id,
                                bounds.offset(
                                    final_rect.x - drag.origin.x,
                                    final_rect.y - drag.origin.y,
                                ),
                                false,
                            );
                        }
                    }
                }
                hook.panels.save();
            }
            WM_SIZE if hook.main => {
                let entries = hook.panels.entries.lock().unwrap().clone();
                for e in entries
                    .iter()
                    .filter(|e| e.handle != hwnd as usize && e.visible && e.ready)
                {
                    ShowWindow(
                        e.handle as HWND,
                        if w == SIZE_MINIMIZED as usize {
                            SW_HIDE
                        } else {
                            SW_SHOWNOACTIVATE
                        },
                    );
                }
            }
            WM_NCDESTROY => {
                RemoveWindowSubclass(hwnd, Some(procedure), id);
                drop(Box::from_raw(data as *mut Hook));
                return DefSubclassProc(hwnd, msg, w, l);
            }
            _ => {}
        }
        DefSubclassProc(hwnd, msg, w, l)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const AREA: Rect = Rect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
    };
    const PLAYER: Rect = Rect {
        x: 100,
        y: 100,
        width: 500,
        height: 400,
    };
    #[test]
    fn magnets_align_a_panel_below_and_beside_player() {
        assert_eq!(
            magnet(
                Rect {
                    x: 107,
                    y: 509,
                    width: 500,
                    height: 220
                },
                &[PLAYER],
                AREA,
                12
            ),
            Rect {
                x: 100,
                y: 500,
                width: 500,
                height: 220
            }
        );
        assert_eq!(
            magnet(
                Rect {
                    x: 608,
                    y: 106,
                    width: 500,
                    height: 220
                },
                &[PLAYER],
                AREA,
                12
            ),
            Rect {
                x: 600,
                y: 100,
                width: 500,
                height: 220
            }
        );
    }
    #[test]
    fn dragging_beyond_threshold_releases_and_distant_panels_do_not_snap() {
        let r = Rect {
            x: 130,
            y: 530,
            width: 500,
            height: 220,
        };
        assert_eq!(magnet(r, &[PLAYER], AREA, 12), r);
        let r = Rect {
            x: 607,
            y: 700,
            width: 500,
            height: 220,
        };
        assert_eq!(magnet(r, &[PLAYER], AREA, 12), r);
    }
    #[test]
    fn main_group_follows_transitive_connections_only() {
        let rects = [
            (1, PLAYER),
            (
                2,
                Rect {
                    x: 100,
                    y: 500,
                    width: 500,
                    height: 200,
                },
            ),
            (
                3,
                Rect {
                    x: 100,
                    y: 700,
                    width: 500,
                    height: 200,
                },
            ),
            (
                4,
                Rect {
                    x: 900,
                    y: 500,
                    width: 500,
                    height: 300,
                },
            ),
        ];
        assert_eq!(connected(&rects, 1), HashSet::from([1, 2, 3]));
    }
    #[test]
    fn screen_edges_include_negative_monitor_coordinates() {
        let a = Rect {
            x: -1920,
            y: -100,
            width: 1920,
            height: 1080,
        };
        let r = magnet(
            Rect {
                x: -1914,
                y: -94,
                width: 500,
                height: 220,
            },
            &[],
            a,
            15,
        );
        assert_eq!((r.x, r.y), (-1920, -100));
    }
    #[test]
    fn slow_drag_escapes_screen_and_panel_magnets() {
        for (origin, targets) in [
            (Rect { y: 0, ..PLAYER }, vec![]),
            (
                Rect {
                    y: 500,
                    height: 200,
                    ..PLAYER
                },
                vec![PLAYER],
            ),
        ] {
            let anchor = (origin.x + 200, origin.y + 12);
            for step in 1..=80 {
                let proposed = drag_position(origin, anchor, (anchor.0, anchor.1 + step));
                let snapped = magnet(proposed, &targets, AREA, 12);
                assert_eq!(snapped.y, origin.y + if step <= 12 { 0 } else { step });
            }
        }
    }
    #[test]
    fn every_panel_window_is_granted_window_permissions() {
        let caps: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let windows = caps["windows"].as_array().unwrap();
        for label in PANEL_LABELS {
            assert!(
                windows.iter().any(|w| w == label),
                "{label} is missing from capabilities/default.json"
            );
        }
    }
    #[test]
    fn native_drag_message_packs_signed_screen_coordinates_by_value() {
        for (x, y) in [(1280, 16), (-1400, 200), (100, -900), (-1920, -1080)] {
            let packed = packed_cursor(x, y);
            assert_eq!(packed as i16 as i32, x);
            assert_eq!((packed >> 16) as i16 as i32, y);
        }
    }
}
