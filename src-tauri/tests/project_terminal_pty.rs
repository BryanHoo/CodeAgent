use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use std::{
    io::{Read, Write},
    sync::mpsc,
    time::Duration,
};

fn assert_shell_roundtrip(mut command: CommandBuilder) {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    command.cwd(std::env::temp_dir());
    #[cfg(unix)]
    command.env("TERM", "xterm-256color");
    let mut child = pair.slave.spawn_command(command).unwrap();
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().unwrap();
    let (sender, receiver) = mpsc::sync_channel(1);
    let worker = std::thread::spawn(move || {
        // 探针只保留 64 KiB；shell profile 输出也不能让测试无限缓存。
        let mut bytes = Vec::new();
        let mut buffer = [0; 4096];
        while let Ok(count) = reader.read(&mut buffer) {
            if count == 0 {
                break;
            }
            if bytes.len() + count > 65536 {
                break;
            }
            bytes.extend_from_slice(&buffer[..count]);
        }
        let _ = sender.send(bytes);
    });
    let mut writer = pair.master.take_writer().unwrap();
    #[cfg(unix)]
    writer
        .write_all(b"printf 'CODEAGENT_%s\\n' PTY_OK; exit\n")
        .unwrap();
    #[cfg(windows)]
    writer
        .write_all(b"echo CODEAGENT_PTY_OK\r\nexit\r\n")
        .unwrap();
    let output = receiver.recv_timeout(Duration::from_secs(5));
    if output.is_err() {
        let _ = child.kill();
    }
    let status = child.wait().unwrap();
    drop(writer);
    drop(pair.master);
    worker.join().unwrap();
    assert!(status.success());
    assert!(String::from_utf8_lossy(&output.unwrap()).contains("CODEAGENT_PTY_OK"));
}

#[test]
fn default_login_shell_accepts_input_and_exits() {
    assert_shell_roundtrip(CommandBuilder::new_default_prog());
}

#[cfg(unix)]
#[test]
fn bash_login_interactive_arguments_accept_input_and_exit() {
    let mut command = CommandBuilder::new("/bin/bash");
    command.args(["--login", "-i"]);
    assert_shell_roundtrip(command);
}

#[cfg(target_os = "macos")]
#[test]
fn zsh_login_interactive_arguments_accept_input_and_exit() {
    let mut command = CommandBuilder::new("/bin/zsh");
    command.args(["-l", "-i"]);
    assert_shell_roundtrip(command);
}

#[cfg(windows)]
#[test]
fn cmd_accepts_input_and_exits() {
    let mut command = CommandBuilder::new("cmd.exe");
    command.args(["/D", "/Q"]);
    assert_shell_roundtrip(command);
}
