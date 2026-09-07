use crate::domain::project_terminal::TerminalError;

#[cfg(unix)]
pub(super) struct ProcessTree {
    groups: Vec<i32>,
}

#[cfg(unix)]
impl ProcessTree {
    pub fn capture(pid: u32, foreground: Option<i32>) -> Result<Self, TerminalError> {
        use std::{
            collections::HashSet,
            io::Read,
            process::{Command, Stdio},
        };
        let root = i32::try_from(pid).map_err(|_| TerminalError::CleanupFailed)?;
        let mut process = Command::new("/bin/ps")
            .args(["-axo", "pid=,ppid=,pgid="])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| TerminalError::CleanupFailed)?;
        let mut data = String::new();
        let read = process
            .stdout
            .take()
            .ok_or(TerminalError::CleanupFailed)?
            .take(1024 * 1024 + 1)
            .read_to_string(&mut data);
        if read.is_err() || data.len() > 1024 * 1024 {
            let _ = process.kill();
            let _ = process.wait();
            return Err(TerminalError::CleanupFailed);
        }
        if !process
            .wait()
            .map_err(|_| TerminalError::CleanupFailed)?
            .success()
        {
            return Err(TerminalError::CleanupFailed);
        }
        let entries: Vec<(i32, i32, i32)> = data
            .lines()
            .filter_map(|line| {
                let mut fields = line.split_whitespace();
                Some((
                    fields.next()?.parse().ok()?,
                    fields.next()?.parse().ok()?,
                    fields.next()?.parse().ok()?,
                ))
            })
            .collect();
        let mut owned = HashSet::from([root]);
        loop {
            let before = owned.len();
            for (id, parent, _) in &entries {
                if owned.contains(parent) {
                    owned.insert(*id);
                }
            }
            if before == owned.len() {
                break;
            }
        }
        let own_group = nix::unistd::getpgrp().as_raw();
        let mut groups = HashSet::from([root]);
        if let Some(group) = foreground {
            groups.insert(group);
        }
        for (id, _, group) in entries {
            if owned.contains(&id) {
                groups.insert(group);
            }
        }
        // 只回收该 PTY 的组，绝不允许无效 PID 或应用自己的进程组进入信号目标。
        if groups
            .iter()
            .any(|group| *group <= 1 || *group == own_group)
        {
            return Err(TerminalError::CleanupFailed);
        }
        Ok(Self {
            groups: groups.into_iter().collect(),
        })
    }

    pub fn terminate(&self, force: bool) -> Result<(), TerminalError> {
        use nix::{
            errno::Errno,
            sys::signal::{Signal, killpg},
            unistd::Pid,
        };
        for group in &self.groups {
            match killpg(
                Pid::from_raw(*group),
                if force {
                    Signal::SIGKILL
                } else {
                    Signal::SIGHUP
                },
            ) {
                Ok(()) | Err(Errno::ESRCH) => {}
                Err(_) => return Err(TerminalError::CleanupFailed),
            }
        }
        Ok(())
    }
}
