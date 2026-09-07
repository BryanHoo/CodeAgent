use crate::domain::project_terminal::encode_frame;
use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use std::{
    io::{Read, Write},
    sync::mpsc,
    time::Duration,
};
use tauri::ipc::{Channel, Response};

pub(super) fn fixture_root(project_id: &str, root_id: &str) -> Option<std::path::PathBuf> {
    // 仅原生测试模式识别固定 fixture；生产构建不包含此项目查询替代入口。
    if std::env::var("CODEAGENT_WEBVIEW_TEST").as_deref() != Ok("1") {
        return None;
    }
    match (project_id, root_id) {
        ("codeagent", "root-codeagent")
        | ("codexly", "root-codexly")
        | ("terminal-bench-third", "root-terminal-bench-third") => {
            std::env::temp_dir().canonicalize().ok()
        }
        _ => None,
    }
}

#[tauri::command]
pub fn inspect_project_terminal_test(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, super::state::AppState>,
) -> Result<serde_json::Value, String> {
    if window.label() != "main" || std::env::var("CODEAGENT_WEBVIEW_TEST").as_deref() != Ok("1") {
        return Err("TERMINAL_SCOPE_MISMATCH".into());
    }
    Ok(state.terminals.test_metrics())
}

// 此模块只编入 webview-tests，固定命令不接受前端 cwd、程序或环境配置。
#[tauri::command]
pub async fn probe_terminal_protocol(
    window: tauri::WebviewWindow,
    on_output: Channel<Response>,
) -> Result<(u16, u16), String> {
    if window.label() != "main" {
        return Err("TERMINAL_SCOPE_MISMATCH".into());
    }
    tauri::async_runtime::spawn_blocking(move || probe(on_output))
        .await
        .map_err(|_| "probe worker failed".to_string())?
}

fn probe(output: Channel<Response>) -> Result<(u16, u16), String> {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    pair.master
        .resize(PtySize {
            rows: 31,
            cols: 97,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    let mut command = CommandBuilder::new("/bin/sh");
    #[cfg(unix)]
    command.args(["-c", "stty size; read -r line; printf '%s\\n' \"$line\""]);
    #[cfg(windows)]
    let mut command = CommandBuilder::new("cmd.exe");
    #[cfg(windows)]
    command.args(["/D", "/Q", "/C", "set /p probe=& echo CODEAGENT_PTY_OK"]);
    command.cwd(std::env::temp_dir());
    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut killer = child.clone_killer();
    let (finished, wait) = mpsc::channel();
    let watchdog = std::thread::spawn(move || {
        if wait.recv_timeout(Duration::from_secs(3)).is_err() {
            let _ = killer.kill();
        }
    });
    let result = (|| {
        let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        writer
            .write_all(b"CODEAGENT_PTY_OK\n")
            .map_err(|e| e.to_string())?;
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let mut buffer = [0u8; 16384];
        let mut sequence = 0;
        let mut offset = 0;
        loop {
            let count = match reader.read(&mut buffer) {
                Ok(count) => count,
                #[cfg(unix)]
                Err(error) if error.raw_os_error() == Some(5) => 0,
                Err(error) => return Err(error.to_string()),
            };
            if count == 0 {
                break;
            }
            sequence += 1;
            offset += count as u64;
            let frame =
                encode_frame(sequence, offset, &buffer[..count]).map_err(|e| e.to_string())?;
            output
                .send(Response::new(frame))
                .map_err(|e| e.to_string())?;
        }
        let status = child.wait().map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("probe shell failed".into());
        }
        let size = pair.master.get_size().map_err(|e| e.to_string())?;
        Ok((size.rows, size.cols))
    })();
    if result.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let _ = finished.send(());
    let _ = watchdog.join();
    result
}
