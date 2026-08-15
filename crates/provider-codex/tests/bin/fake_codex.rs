//! 脚本化 Codex App Server 假进程，仅用于集成测试。
//!
//! 场景通过 `FAKE_CODEX_SCENARIO` 环境变量传入 JSON：
//! `onRequest.<method>` 是按调用次数消费的动作序列（最后一组重复），
//! `onNotification.<method>`、`onServerResponse.<id>`、`onStart` 为单组动作。
//! 支持动作：reply、replyError、notify、request、raw、stderrLine、sleepMs、exit。

use std::collections::HashMap;
use std::io::{BufRead, Write};

use serde_json::{Value, json};

fn main() {
    let arguments: Vec<String> = std::env::args().collect();
    if arguments.get(1).map(String::as_str) == Some("--version") {
        if let Ok(message) = std::env::var("FAKE_CODEX_VERSION_ERROR") {
            eprint!("{message}");
            std::process::exit(1);
        }
        let version = std::env::var("FAKE_CODEX_VERSION").unwrap_or_else(|_| "0.147.0".to_string());
        println!("codex-cli {version}");
        return;
    }

    let scenario: Value = std::env::var("FAKE_CODEX_SCENARIO")
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| json!({}));
    run(&scenario);
}

fn run(scenario: &Value) {
    if let Some(actions) = scenario["onStart"].as_array() {
        execute_actions(actions, None);
    }

    let stdin = std::io::stdin();
    let mut reader = stdin.lock();
    let mut request_counts: HashMap<String, usize> = HashMap::new();
    let mut line = String::new();

    loop {
        line.clear();
        let read = reader.read_line(&mut line).unwrap_or(0);
        if read == 0 {
            handle_stdin_end(scenario);
            return;
        }
        if line.trim().is_empty() {
            continue;
        }
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };

        let id = message.get("id").cloned();
        let method = message.get("method").and_then(Value::as_str);
        match (id, method) {
            (Some(id), Some(method)) => {
                let call_index = request_counts.entry(method.to_string()).or_insert(0);
                let actions = request_actions(scenario, method, *call_index);
                *call_index += 1;
                match actions {
                    Some(actions) => execute_actions(&actions, Some(&id)),
                    // 未脚本化的请求默认成功返回空对象，保证握手可用。
                    None => write_stdout_line(&json!({ "id": id, "result": {} }).to_string()),
                }
            }
            (None, Some(method)) => {
                if let Some(actions) = scenario["onNotification"][method].as_array() {
                    execute_actions(actions, None);
                }
            }
            (Some(id), None) => {
                let key = match &id {
                    Value::String(text) => text.clone(),
                    other => other.to_string(),
                };
                if let Some(actions) = scenario["onServerResponse"][key.as_str()].as_array() {
                    execute_actions(actions, Some(&id));
                }
            }
            (None, None) => {}
        }
    }
}

fn request_actions(scenario: &Value, method: &str, call_index: usize) -> Option<Vec<Value>> {
    let sequences = scenario["onRequest"][method].as_array()?;
    if sequences.is_empty() {
        return None;
    }
    let selected = sequences
        .get(call_index)
        .or_else(|| sequences.last())?
        .as_array()?;
    Some(selected.clone())
}

fn handle_stdin_end(scenario: &Value) {
    if scenario["ignoreStdinClose"].as_bool() == Some(true) {
        // 故意无视关闭请求，供关闭升级路径测试使用。
        loop {
            std::thread::sleep(std::time::Duration::from_secs(60));
        }
    }
}

fn execute_actions(actions: &[Value], current_id: Option<&Value>) {
    for action in actions {
        if let Some(result) = action.get("reply") {
            if let Some(id) = current_id {
                write_stdout_line(&json!({ "id": id, "result": result }).to_string());
            }
        } else if let Some(error) = action.get("replyError") {
            if let Some(id) = current_id {
                write_stdout_line(&json!({ "id": id, "error": error }).to_string());
            }
        } else if let Some(notification) = action.get("notify") {
            write_stdout_line(
                &json!({
                    "method": notification["method"],
                    "params": notification.get("params").cloned().unwrap_or(Value::Null)
                })
                .to_string(),
            );
        } else if let Some(request) = action.get("request") {
            write_stdout_line(
                &json!({
                    "id": request["id"],
                    "method": request["method"],
                    "params": request.get("params").cloned().unwrap_or(Value::Null)
                })
                .to_string(),
            );
        } else if let Some(raw) = action.get("raw").and_then(Value::as_str) {
            write_stdout_line(raw);
        } else if let Some(text) = action.get("stderrLine").and_then(Value::as_str) {
            let mut stderr = std::io::stderr().lock();
            let _ = writeln!(stderr, "{text}");
            let _ = stderr.flush();
        } else if let Some(delay) = action.get("sleepMs").and_then(Value::as_u64) {
            std::thread::sleep(std::time::Duration::from_millis(delay));
        } else if let Some(code) = action.get("exit").and_then(Value::as_i64) {
            let _ = std::io::stdout().lock().flush();
            let _ = std::io::stderr().lock().flush();
            #[allow(clippy::cast_possible_truncation)]
            std::process::exit(code as i32);
        }
    }
}

fn write_stdout_line(line: &str) {
    let mut stdout = std::io::stdout().lock();
    let _ = writeln!(stdout, "{line}");
    let _ = stdout.flush();
}
