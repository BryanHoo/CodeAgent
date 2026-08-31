use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use tokio::sync::{Mutex, mpsc};

use super::error::AppError;
use crate::infrastructure::app_storage;

const PREFERENCE_QUEUE_CAPACITY: usize = 64;
const PREFERENCE_WRITE_DELAY: std::time::Duration = std::time::Duration::from_millis(100);
const PREFERENCE_RETRY_DELAY: std::time::Duration = std::time::Duration::from_secs(1);

type PreferenceUpdates = BTreeMap<String, Option<String>>;

#[derive(Default)]
pub(crate) struct AppStorageRuntime {
    sender: Mutex<Option<mpsc::Sender<PreferenceUpdates>>>,
}

#[derive(Default)]
pub(super) struct PreferenceWriteBuffer {
    updates: PreferenceUpdates,
}

impl PreferenceWriteBuffer {
    pub(super) fn merge(&mut self, updates: PreferenceUpdates) {
        self.updates.extend(updates);
    }

    pub(super) fn take(&mut self) -> PreferenceUpdates {
        std::mem::take(&mut self.updates)
    }

    pub(super) fn restore_failed(&mut self, updates: PreferenceUpdates) {
        // 已进入缓冲的新值优先于失败批次中的旧值。
        for (key, value) in updates {
            self.updates.entry(key).or_insert(value);
        }
    }

    pub(super) fn is_empty(&self) -> bool {
        self.updates.is_empty()
    }
}

impl AppStorageRuntime {
    pub(crate) async fn enqueue(
        &self,
        app_data: PathBuf,
        updates: PreferenceUpdates,
    ) -> Result<(), AppError> {
        let sender = self.sender(&app_data).await;
        if sender.send(updates.clone()).await.is_ok() {
            return Ok(());
        }

        // actor 异常退出后只重建一次，避免让 WebView 接管重试职责。
        let sender = self.replace_sender(app_data).await;
        sender
            .send(updates)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed)
    }

    async fn sender(&self, app_data: &Path) -> mpsc::Sender<PreferenceUpdates> {
        let mut sender = self.sender.lock().await;
        if let Some(existing) = sender.as_ref()
            && !existing.is_closed()
        {
            return existing.clone();
        }
        let created = spawn_preference_writer(app_data.to_path_buf());
        *sender = Some(created.clone());
        created
    }

    async fn replace_sender(&self, app_data: PathBuf) -> mpsc::Sender<PreferenceUpdates> {
        let created = spawn_preference_writer(app_data);
        *self.sender.lock().await = Some(created.clone());
        created
    }
}

fn spawn_preference_writer(app_data: PathBuf) -> mpsc::Sender<PreferenceUpdates> {
    let (sender, receiver) = mpsc::channel(PREFERENCE_QUEUE_CAPACITY);
    tauri::async_runtime::spawn(run_preference_writer(app_data, receiver));
    sender
}

async fn run_preference_writer(app_data: PathBuf, mut receiver: mpsc::Receiver<PreferenceUpdates>) {
    let mut buffer = PreferenceWriteBuffer::default();
    while let Some(updates) = receiver.recv().await {
        buffer.merge(updates);
        collect_until_deadline(&mut buffer, &mut receiver, PREFERENCE_WRITE_DELAY).await;

        while !buffer.is_empty() {
            let updates = buffer.take();
            if let Err(error) = app_storage::update_preferences(&app_data, updates.clone()).await {
                eprintln!("failed to persist app preferences: {error}");
                buffer.restore_failed(updates);
                collect_until_deadline(&mut buffer, &mut receiver, PREFERENCE_RETRY_DELAY).await;
                continue;
            }
        }
    }
}

async fn collect_until_deadline(
    buffer: &mut PreferenceWriteBuffer,
    receiver: &mut mpsc::Receiver<PreferenceUpdates>,
    delay: std::time::Duration,
) {
    let deadline = tokio::time::sleep(delay);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            () = &mut deadline => return,
            update = receiver.recv() => match update {
                Some(update) => buffer.merge(update),
                None => return,
            },
        }
    }
}
