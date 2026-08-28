use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
#[cfg(not(target_os = "macos"))]
use tauri::Emitter;
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, utils::config::BackgroundThrottlingPolicy,
};

#[cfg(not(target_os = "macos"))]
use super::desktop_pet_commands::{DesktopPetPosition, DesktopPetRuntime};
use super::error::AppError;
use crate::infrastructure::app_storage;

pub(super) const DESKTOP_PET_EVENT: &str = "desktop-pet://state";
#[cfg(not(target_os = "macos"))]
const DESKTOP_PET_MOVED_EVENT: &str = "desktop-pet://moved";
pub(super) const DESKTOP_PET_LABEL: &str = "desktop-pet";
pub(super) const DESKTOP_PET_BUBBLES_LABEL: &str = "desktop-pet-bubbles";
const DESKTOP_PET_POSITION_KEY: &str = "codeagent.desktop-pet-position";
const PET_WINDOW_MARGIN: i32 = 24;
const PET_BUBBLE_GAP_LOGICAL: f64 = 8.0;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredPetPosition {
    version: u8,
    x: i32,
    y: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct MonitorBounds {
    height: u32,
    width: u32,
    x: i32,
    y: i32,
}

impl MonitorBounds {
    const fn new(x: i32, y: i32, width: u32, height: u32) -> Self {
        Self {
            height,
            width,
            x,
            y,
        }
    }

    fn contains_window(self, position: PhysicalPosition<i32>, size: PhysicalSize<u32>) -> bool {
        let right = i64::from(position.x) + i64::from(size.width);
        let bottom = i64::from(position.y) + i64::from(size.height);
        position.x >= self.x
            && position.y >= self.y
            && right <= i64::from(self.x) + i64::from(self.width)
            && bottom <= i64::from(self.y) + i64::from(self.height)
    }

    fn contains_point(self, position: PhysicalPosition<i32>) -> bool {
        position.x >= self.x
            && position.y >= self.y
            && i64::from(position.x) < i64::from(self.x) + i64::from(self.width)
            && i64::from(position.y) < i64::from(self.y) + i64::from(self.height)
    }

    fn safe_corner(self, size: PhysicalSize<u32>) -> PhysicalPosition<i32> {
        let width = i32::try_from(size.width).unwrap_or(i32::MAX);
        let height = i32::try_from(size.height).unwrap_or(i32::MAX);
        PhysicalPosition {
            x: self.x + i32::try_from(self.width).unwrap_or(i32::MAX) - width - PET_WINDOW_MARGIN,
            y: self.y + i32::try_from(self.height).unwrap_or(i32::MAX) - height - PET_WINDOW_MARGIN,
        }
    }

    fn clamp_window(
        self,
        position: PhysicalPosition<i32>,
        size: PhysicalSize<u32>,
    ) -> PhysicalPosition<i32> {
        let width = i32::try_from(size.width).unwrap_or(i32::MAX);
        let height = i32::try_from(size.height).unwrap_or(i32::MAX);
        let max_x = self
            .x
            .saturating_add(i32::try_from(self.width).unwrap_or(i32::MAX))
            .saturating_sub(width);
        let max_y = self
            .y
            .saturating_add(i32::try_from(self.height).unwrap_or(i32::MAX))
            .saturating_sub(height);
        PhysicalPosition::new(
            position.x.clamp(self.x, max_x.max(self.x)),
            position.y.clamp(self.y, max_y.max(self.y)),
        )
    }
}

pub(super) fn resolve_pet_position(
    saved: Option<PhysicalPosition<i32>>,
    monitors: &[MonitorBounds],
    window_size: PhysicalSize<u32>,
) -> PhysicalPosition<i32> {
    if let Some(position) = saved
        && monitors
            .iter()
            .any(|monitor| monitor.contains_window(position, window_size))
    {
        return position;
    }
    monitors.first().copied().map_or(
        PhysicalPosition::new(PET_WINDOW_MARGIN, PET_WINDOW_MARGIN),
        |monitor| monitor.safe_corner(window_size),
    )
}

pub(super) fn move_pet_position(
    current: PhysicalPosition<i32>,
    delta_x: i32,
    delta_y: i32,
    monitors: &[MonitorBounds],
    window_size: PhysicalSize<u32>,
) -> PhysicalPosition<i32> {
    let target = PhysicalPosition::new(
        current.x.saturating_add(delta_x),
        current.y.saturating_add(delta_y),
    );
    monitors
        .iter()
        .copied()
        .find(|monitor| monitor.contains_window(current, window_size))
        .or_else(|| monitors.first().copied())
        .map_or(target, |monitor| monitor.clamp_window(target, window_size))
}

pub(super) fn drag_pet_position(
    target: PhysicalPosition<i32>,
    monitors: &[MonitorBounds],
    window_size: PhysicalSize<u32>,
) -> PhysicalPosition<i32> {
    let center = PhysicalPosition::new(
        target
            .x
            .saturating_add(i32::try_from(window_size.width / 2).unwrap_or(i32::MAX)),
        target
            .y
            .saturating_add(i32::try_from(window_size.height / 2).unwrap_or(i32::MAX)),
    );
    if monitors
        .iter()
        .any(|monitor| monitor.contains_point(center))
    {
        return target;
    }
    monitors
        .iter()
        .copied()
        .min_by_key(|monitor| {
            let clamped = monitor.clamp_window(target, window_size);
            let dx = i128::from(target.x) - i128::from(clamped.x);
            let dy = i128::from(target.y) - i128::from(clamped.y);
            dx * dx + dy * dy
        })
        .map_or(target, |monitor| monitor.clamp_window(target, window_size))
}

fn bubble_position(
    pet_position: PhysicalPosition<i32>,
    pet_size: PhysicalSize<u32>,
    bubble_size: PhysicalSize<u32>,
    monitors: &[MonitorBounds],
    gap: i32,
) -> PhysicalPosition<i32> {
    let monitor = monitors
        .iter()
        .copied()
        .find(|monitor| monitor.contains_window(pet_position, pet_size))
        .or_else(|| monitors.first().copied());
    let Some(monitor) = monitor else {
        return pet_position;
    };
    let pet_width = i32::try_from(pet_size.width).unwrap_or(i32::MAX);
    let bubble_width = i32::try_from(bubble_size.width).unwrap_or(i32::MAX);
    let bubble_height = i32::try_from(bubble_size.height).unwrap_or(i32::MAX);
    let x = pet_position
        .x
        .saturating_add(pet_width)
        .saturating_sub(bubble_width)
        .clamp(
            monitor.x,
            monitor
                .x
                .saturating_add(i32::try_from(monitor.width).unwrap_or(i32::MAX))
                .saturating_sub(bubble_width)
                .max(monitor.x),
        );
    let y = pet_position
        .y
        .saturating_sub(bubble_height)
        .saturating_sub(gap);
    PhysicalPosition::new(x, y)
}

pub(super) fn monitor_bounds(window: &WebviewWindow) -> Result<Vec<MonitorBounds>, AppError> {
    window
        .available_monitors()
        .map_err(|_| AppError::DesktopPetWindowFailed)
        .map(|monitors| {
            monitors
                .into_iter()
                .map(|monitor| {
                    let area = monitor.work_area();
                    MonitorBounds::new(
                        area.position.x,
                        area.position.y,
                        area.size.width,
                        area.size.height,
                    )
                })
                .collect()
        })
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)
}

async fn read_stored_position(app: &AppHandle) -> Result<Option<PhysicalPosition<i32>>, AppError> {
    let preferences = app_storage::read_preferences(&app_data_dir(app)?)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(preferences
        .get(DESKTOP_PET_POSITION_KEY)
        .and_then(|value| serde_json::from_str::<StoredPetPosition>(value).ok())
        .filter(|position| position.version == 1)
        .map(|position| PhysicalPosition::new(position.x, position.y)))
}

pub(super) async fn persist_position(
    app: &AppHandle,
    position: PhysicalPosition<i32>,
) -> Result<(), AppError> {
    let value = serde_json::to_string(&StoredPetPosition {
        version: 1,
        x: position.x,
        y: position.y,
    })
    .map_err(|_| AppError::FilesystemRequestFailed)?;
    let mut updates = BTreeMap::new();
    updates.insert(DESKTOP_PET_POSITION_KEY.to_string(), Some(value));
    app_storage::update_preferences(&app_data_dir(app)?, updates)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)
}

pub(super) async fn create_desktop_pet_window(app: &AppHandle) -> Result<WebviewWindow, AppError> {
    let saved_position = read_stored_position(app).await?;
    let window = overlay_window_builder(
        app,
        DESKTOP_PET_LABEL,
        "index.html?window=desktop-pet",
        "CodeAgent Pet",
        96.0,
        96.0,
    )
    .build()
    .map_err(|_| AppError::DesktopPetWindowFailed)?;
    #[cfg(target_os = "macos")]
    super::desktop_pet_panel::configure_desktop_overlay(&window).await?;

    // 使用工作区而非整块屏幕，避免首次出现时落到 Dock 或任务栏下方。
    let position = resolve_pet_position(
        saved_position,
        &monitor_bounds(&window)?,
        window
            .outer_size()
            .map_err(|_| AppError::DesktopPetWindowFailed)?,
    );
    window
        .set_position(position)
        .map_err(|_| AppError::DesktopPetWindowFailed)?;
    #[cfg(not(target_os = "macos"))]
    {
        let event_app = app.clone();
        let event_window = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::Moved(position) = event {
                let _ =
                    event_window.emit(DESKTOP_PET_MOVED_EVENT, DesktopPetPosition::from(*position));
                let _ = position_desktop_pet_bubbles(&event_app, *position);
                event_app
                    .state::<DesktopPetRuntime>()
                    .schedule_position_persist(event_app.clone(), *position);
            }
        });
    }
    Ok(window)
}

pub(super) async fn create_desktop_pet_bubbles_window(
    app: &AppHandle,
) -> Result<WebviewWindow, AppError> {
    let window = overlay_window_builder(
        app,
        DESKTOP_PET_BUBBLES_LABEL,
        "index.html?window=desktop-pet-bubbles",
        "CodeAgent Pet Activity",
        192.0,
        32.0,
    )
    .build()
    .map_err(|_| AppError::DesktopPetWindowFailed)?;
    #[cfg(target_os = "macos")]
    {
        super::desktop_pet_panel::configure_desktop_overlay(&window).await?;
        super::desktop_pet_panel::attach_desktop_pet_bubbles(app).await?;
    }
    Ok(window)
}

fn overlay_window_builder<'a>(
    app: &'a AppHandle,
    label: &'a str,
    url: &'a str,
    title: &'a str,
    width: f64,
    height: f64,
) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(width, height)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .decorations(false)
        .shadow(false)
        .transparent(true)
        .background_throttling(BackgroundThrottlingPolicy::Disabled)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        .accept_first_mouse(true)
        .visible(false)
}

pub(super) fn position_desktop_pet_bubbles(
    app: &AppHandle,
    pet_position: PhysicalPosition<i32>,
) -> Result<(), AppError> {
    let Some(pet_window) = app.get_webview_window(DESKTOP_PET_LABEL) else {
        return Ok(());
    };
    let Some(bubble_window) = app.get_webview_window(DESKTOP_PET_BUBBLES_LABEL) else {
        return Ok(());
    };
    let scale = pet_window
        .scale_factor()
        .map_err(|_| AppError::DesktopPetWindowFailed)?;
    let gap = (PET_BUBBLE_GAP_LOGICAL * scale).round() as i32;
    let position = bubble_position(
        pet_position,
        pet_window
            .outer_size()
            .map_err(|_| AppError::DesktopPetWindowFailed)?,
        bubble_window
            .outer_size()
            .map_err(|_| AppError::DesktopPetWindowFailed)?,
        &monitor_bounds(&pet_window)?,
        gap,
    );
    bubble_window
        .set_position(position)
        .map_err(|_| AppError::DesktopPetWindowFailed)
}

pub(super) async fn destroy_desktop_pet_window(
    app: &AppHandle,
    label: &str,
) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        return super::desktop_pet_panel::destroy_desktop_overlay(app, label).await;
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app.get_webview_window(label) {
            window
                .destroy()
                .map_err(|_| AppError::DesktopPetWindowFailed)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PET_SIZE: PhysicalSize<u32> = PhysicalSize::new(96, 96);

    #[test]
    fn restores_a_position_that_is_visible_on_a_secondary_monitor() {
        let monitors = [
            MonitorBounds::new(0, 0, 1920, 1080),
            MonitorBounds::new(-1280, 0, 1280, 1024),
        ];
        assert_eq!(
            resolve_pet_position(Some(PhysicalPosition::new(-640, 400)), &monitors, PET_SIZE,),
            PhysicalPosition::new(-640, 400),
        );
    }

    #[test]
    fn moves_an_offscreen_position_to_the_primary_monitor_safe_corner() {
        assert_eq!(
            resolve_pet_position(
                Some(PhysicalPosition::new(4000, 3000)),
                &[MonitorBounds::new(0, 0, 1920, 1080)],
                PET_SIZE,
            ),
            PhysicalPosition::new(1800, 960),
        );
    }

    #[test]
    fn bubbles_stay_above_the_pet_at_the_top_edge() {
        assert_eq!(
            bubble_position(
                PhysicalPosition::new(100, 0),
                PET_SIZE,
                PhysicalSize::new(192, 64),
                &[MonitorBounds::new(0, 0, 1920, 1080)],
                8,
            ),
            PhysicalPosition::new(4, -72),
        );
    }

    #[test]
    fn desktop_drag_crosses_adjacent_monitors_without_clamping_at_the_seam() {
        let monitors = [
            MonitorBounds::new(0, 0, 1920, 1080),
            MonitorBounds::new(1920, 0, 2560, 1440),
        ];
        assert_eq!(
            drag_pet_position(PhysicalPosition::new(1880, 400), &monitors, PET_SIZE),
            PhysicalPosition::new(1880, 400),
        );
    }
}
