use std::env;
use std::process::{self, Command, Stdio};

const NODE_ENV: &str = "CODE_AGENT_FAKE_CODEX_NODE";
const SCRIPT_ENV: &str = "CODE_AGENT_FAKE_CODEX_SCRIPT";

fn main() {
    match run() {
        Ok(code) => process::exit(code),
        Err(message) => {
            eprintln!("fake Codex launcher failed: {message}");
            process::exit(1);
        }
    }
}

fn run() -> Result<i32, String> {
    let node = env::var_os(NODE_ENV).ok_or_else(|| format!("missing {NODE_ENV}"))?;
    let script = env::var_os(SCRIPT_ENV).ok_or_else(|| format!("missing {SCRIPT_ENV}"))?;

    // 使用原生可执行文件承接 Provider 的 stdio，避免 Windows 直接执行 .mjs 触发错误 193。
    let status = Command::new(node)
        .arg(script)
        .args(env::args_os().skip(1))
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|error| format!("could not start Node.js: {error}"))?;

    Ok(status.code().unwrap_or(1))
}
