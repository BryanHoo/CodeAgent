use std::{
    collections::VecDeque,
    sync::{Arc, Mutex, MutexGuard},
};

use tokio::sync::Notify;

pub const MAILBOX_MAX_EVENTS: usize = 64;
pub const MAILBOX_MAX_BYTES: usize = 256 * 1024;
pub const PULL_MAX_EVENTS: usize = 64;
pub const PULL_MAX_BYTES: usize = 256 * 1024;
pub const PULL_BATCH_MAGIC: u32 = 0x4341_4550;

struct MailboxState {
    bytes: usize,
    closed: bool,
    frames: VecDeque<Arc<[u8]>>,
    pending_notify: bool,
}

/// Desktop 事件 mailbox：限制进入 WebView 之前的在途业务帧。
#[derive(Clone)]
pub struct EventMailbox {
    space: Arc<Notify>,
    state: Arc<Mutex<MailboxState>>,
}

impl EventMailbox {
    pub fn new() -> Self {
        Self {
            space: Arc::new(Notify::new()),
            state: Arc::new(Mutex::new(MailboxState {
                bytes: 0,
                closed: false,
                frames: VecDeque::new(),
                pending_notify: false,
            })),
        }
    }

    pub async fn admit(&self, frame: Arc<[u8]>) -> bool {
        loop {
            let notified = {
                let mut state = self.lock();
                if state.closed {
                    return false;
                }
                if can_admit(&state, frame.len()) {
                    let was_empty = state.frames.is_empty();
                    state.bytes = state.bytes.saturating_add(frame.len());
                    state.frames.push_back(frame);
                    if was_empty && !state.pending_notify {
                        state.pending_notify = true;
                    }
                    return true;
                }
                self.space.notified()
            };
            notified.await;
        }
    }

    pub fn pull(&self, max_events: usize, max_bytes: usize) -> Vec<Arc<[u8]>> {
        let taken = {
            let mut state = self.lock();
            if state.frames.is_empty() {
                return Vec::new();
            }
            let max_events = max_events.max(1);
            let max_bytes = max_bytes.max(1);
            let mut taken = Vec::new();
            let mut taken_bytes = 0usize;
            while let Some(frame) = state.frames.pop_front() {
                let frame_len = frame.len();
                if !taken.is_empty()
                    && (taken.len() >= max_events
                        || taken_bytes.saturating_add(frame_len) > max_bytes)
                {
                    state.frames.push_front(frame);
                    break;
                }
                state.bytes = state.bytes.saturating_sub(frame_len);
                taken_bytes = taken_bytes.saturating_add(frame_len);
                taken.push(frame);
            }
            taken
        };
        self.space.notify_waiters();
        taken
    }

    pub fn close(&self) {
        {
            let mut state = self.lock();
            state.closed = true;
            state.frames.clear();
            state.bytes = 0;
        }
        self.space.notify_waiters();
    }

    pub fn take_notify_hint(&self) -> bool {
        let mut state = self.lock();
        let hint = state.pending_notify;
        state.pending_notify = false;
        hint
    }

    pub fn on_pull_started(&self) {
        self.lock().pending_notify = false;
    }

    pub fn notify_if_remaining(&self) -> bool {
        let mut state = self.lock();
        if state.closed || state.frames.is_empty() || state.pending_notify {
            return false;
        }
        state.pending_notify = true;
        true
    }

    fn lock(&self) -> MutexGuard<'_, MailboxState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn can_admit(state: &MailboxState, frame_len: usize) -> bool {
    if state.frames.is_empty() {
        return true;
    }
    state.frames.len() < MAILBOX_MAX_EVENTS
        && state.bytes.saturating_add(frame_len) <= MAILBOX_MAX_BYTES
}

pub fn clamp_pull_budget(max_events: Option<u32>, max_bytes: Option<u32>) -> (usize, usize) {
    (
        max_events
            .unwrap_or(PULL_MAX_EVENTS as u32)
            .clamp(1, PULL_MAX_EVENTS as u32) as usize,
        max_bytes
            .unwrap_or(PULL_MAX_BYTES as u32)
            .clamp(1, PULL_MAX_BYTES as u32) as usize,
    )
}

pub fn encode_pull_batch(frames: &[Arc<[u8]>]) -> Vec<u8> {
    let mut size = 8usize;
    for frame in frames {
        size = size.saturating_add(4).saturating_add(frame.len());
    }
    let mut out = Vec::with_capacity(size);
    out.extend_from_slice(&PULL_BATCH_MAGIC.to_le_bytes());
    out.extend_from_slice(&(u32::try_from(frames.len()).unwrap_or(u32::MAX)).to_le_bytes());
    for frame in frames {
        out.extend_from_slice(&(u32::try_from(frame.len()).unwrap_or(u32::MAX)).to_le_bytes());
        out.extend_from_slice(frame);
    }
    out
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use super::{
        EventMailbox, MAILBOX_MAX_BYTES, MAILBOX_MAX_EVENTS, PULL_BATCH_MAGIC, PULL_MAX_BYTES,
        PULL_MAX_EVENTS, clamp_pull_budget, encode_pull_batch,
    };

    fn frame(tag: u8, len: usize) -> Arc<[u8]> {
        Arc::from(vec![tag; len])
    }

    #[tokio::test]
    async fn admit_should_wait_until_pull_releases_event_capacity() {
        let mailbox = EventMailbox::new();
        for index in 0..MAILBOX_MAX_EVENTS {
            assert!(
                mailbox
                    .admit(frame(u8::try_from(index).unwrap_or(1), 1))
                    .await
            );
        }
        let pending = tokio::spawn({
            let mailbox = mailbox.clone();
            async move { mailbox.admit(frame(255, 1)).await }
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!pending.is_finished());
        assert_eq!(mailbox.pull(1, MAILBOX_MAX_BYTES).len(), 1);
        assert!(pending.await.expect("join"));
    }

    #[tokio::test]
    async fn admit_should_wait_until_pull_releases_byte_capacity() {
        let mailbox = EventMailbox::new();
        let chunk = MAILBOX_MAX_BYTES / 4;
        for _ in 0..4 {
            assert!(mailbox.admit(frame(7, chunk)).await);
        }
        let pending = tokio::spawn({
            let mailbox = mailbox.clone();
            async move { mailbox.admit(frame(8, chunk)).await }
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!pending.is_finished());
        assert_eq!(mailbox.pull(1, MAILBOX_MAX_BYTES).len(), 1);
        assert!(pending.await.expect("join"));
    }

    #[tokio::test]
    async fn close_should_wake_waiting_admit_as_false() {
        let mailbox = EventMailbox::new();
        for _ in 0..MAILBOX_MAX_EVENTS {
            assert!(mailbox.admit(frame(1, 1)).await);
        }
        let pending = tokio::spawn({
            let mailbox = mailbox.clone();
            async move { mailbox.admit(frame(2, 1)).await }
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        mailbox.close();
        assert!(!pending.await.expect("join"));
    }

    #[tokio::test]
    async fn empty_mailbox_should_admit_one_oversized_frame() {
        let mailbox = EventMailbox::new();
        assert!(mailbox.admit(frame(9, MAILBOX_MAX_BYTES + 8)).await);
        let pulled = mailbox.pull(1, 1);
        assert_eq!(pulled.len(), 1);
        assert_eq!(pulled[0].len(), MAILBOX_MAX_BYTES + 8);
    }

    #[test]
    fn clamp_pull_budget_should_bound_and_default() {
        assert_eq!(
            clamp_pull_budget(None, None),
            (PULL_MAX_EVENTS, PULL_MAX_BYTES)
        );
        assert_eq!(clamp_pull_budget(Some(0), Some(0)), (1, 1));
        assert_eq!(
            clamp_pull_budget(Some(1_000), Some(u32::MAX)),
            (PULL_MAX_EVENTS, PULL_MAX_BYTES)
        );
    }

    #[test]
    fn encode_pull_batch_should_prefix_magic_and_frame_lengths() {
        let frames = [frame(1, 2), frame(2, 3)];
        let encoded = encode_pull_batch(&frames);
        assert_eq!(&encoded[..4], &PULL_BATCH_MAGIC.to_le_bytes());
        assert_eq!(&encoded[4..8], &2u32.to_le_bytes());
        assert_eq!(&encoded[8..12], &2u32.to_le_bytes());
        assert_eq!(&encoded[12..14], &[1, 1]);
        assert_eq!(&encoded[14..18], &3u32.to_le_bytes());
        assert_eq!(&encoded[18..], &[2, 2, 2]);
    }

    #[tokio::test]
    async fn notify_hint_should_coalesce_until_pull_drains() {
        let mailbox = EventMailbox::new();
        assert!(mailbox.admit(frame(1, 1)).await);
        assert!(mailbox.admit(frame(2, 1)).await);
        assert!(mailbox.take_notify_hint());
        assert!(!mailbox.take_notify_hint());
        mailbox.on_pull_started();
        assert_eq!(mailbox.pull(1, MAILBOX_MAX_BYTES).len(), 1);
        assert!(mailbox.notify_if_remaining());
        mailbox.on_pull_started();
        assert_eq!(mailbox.pull(8, MAILBOX_MAX_BYTES).len(), 1);
        assert!(!mailbox.notify_if_remaining());
    }

    #[test]
    fn encode_pull_batch_should_allow_empty_mailbox() {
        let encoded = encode_pull_batch(&[]);
        assert_eq!(&encoded[..4], &PULL_BATCH_MAGIC.to_le_bytes());
        assert_eq!(&encoded[4..], &0u32.to_le_bytes());
    }
}
