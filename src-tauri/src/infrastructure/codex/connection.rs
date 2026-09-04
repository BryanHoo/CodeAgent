use std::{
    collections::HashMap,
    path::Path,
    pin::Pin,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use serde::{Serialize, de::DeserializeOwned};
use serde_json::value::RawValue;
use thiserror::Error;
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader},
    sync::{Mutex as AsyncMutex, mpsc, oneshot},
    task::JoinHandle,
    time::{sleep, timeout},
};

use crate::infrastructure::diagnostics;

use super::connection_event_buffer::NotificationBuffer;
use super::generated_image_store::GeneratedImageStore;
use super::protocol::{
    ClientInfo, IGNORED_NOTIFICATION_METHODS, IncomingMessage, InitializeCapabilities,
    InitializeParams, InitializeResponse, RpcError, encode_notification, encode_request,
    encode_response,
};

type PendingResult = Result<Box<RawValue>, PendingError>;
type PendingRequests = Arc<Mutex<HashMap<u64, oneshot::Sender<PendingResult>>>>;
type AsyncWriter = Pin<Box<dyn AsyncWrite + Send>>;
const OVERLOAD_RETRY_DELAYS: [Duration; 2] =
    [Duration::from_millis(25), Duration::from_millis(100)];
const NOTIFICATION_OVERFLOW_CAPACITY: usize = 256;
// 普通 JSONL 帧控制在 8 MiB；图片帧为 50 MiB 解码内容预留 Base64 和信封空间。
pub(super) const MAX_STANDARD_FRAME_BYTES: usize = 8 * 1024 * 1024;
pub(super) const MAX_IMAGE_FRAME_BYTES: usize = 72 * 1024 * 1024;

#[derive(Clone, Debug)]
enum PendingError {
    Request(RpcError),
    ConnectionClosed,
    InvalidMessage,
}

#[derive(Debug, Error)]
pub enum ConnectionError {
    #[error("failed to process app-server JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("failed to write app-server message: {0}")]
    Write(#[from] std::io::Error),
    #[error("app-server request failed with code {code}: {message}")]
    Request { code: i64, message: String },
    #[error("app-server connection closed")]
    ConnectionClosed,
    #[error("app-server returned an invalid response")]
    InvalidMessage,
    #[error("app-server request timed out")]
    Timeout,
    #[error("app-server request state is unavailable")]
    StateUnavailable,
}

pub struct AppServerConnection {
    writer: AsyncMutex<AsyncWriter>,
    pending: PendingRequests,
    server_messages: AsyncMutex<Option<mpsc::Receiver<ServerMessage>>>,
    next_id: AtomicU64,
    reader_task: JoinHandle<()>,
}

#[derive(Debug)]
pub struct ServerMessage {
    pub id: Option<u64>,
    pub method: String,
    pub params: Box<RawValue>,
}

impl AppServerConnection {
    #[cfg(test)]
    pub fn new<R, W>(reader: R, writer: W) -> Self
    where
        R: AsyncRead + Send + Unpin + 'static,
        W: AsyncWrite + Send + Unpin + 'static,
    {
        Self::build(reader, writer, None)
    }

    pub fn with_image_store<R, W>(reader: R, writer: W, app_data: &Path) -> Self
    where
        R: AsyncRead + Send + Unpin + 'static,
        W: AsyncWrite + Send + Unpin + 'static,
    {
        Self::build(reader, writer, Some(GeneratedImageStore::new(app_data)))
    }

    fn build<R, W>(reader: R, writer: W, image_store: Option<GeneratedImageStore>) -> Self
    where
        R: AsyncRead + Send + Unpin + 'static,
        W: AsyncWrite + Send + Unpin + 'static,
    {
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let reader_pending = Arc::clone(&pending);
        let (message_sender, message_receiver) = mpsc::channel(256);
        let reader_task = tokio::spawn(read_responses(
            reader,
            reader_pending,
            message_sender,
            image_store,
        ));

        Self {
            writer: AsyncMutex::new(Box::pin(writer)),
            pending,
            server_messages: AsyncMutex::new(Some(message_receiver)),
            next_id: AtomicU64::new(1),
            reader_task,
        }
    }

    pub async fn take_server_messages(
        &self,
    ) -> Result<mpsc::Receiver<ServerMessage>, ConnectionError> {
        self.server_messages
            .lock()
            .await
            .take()
            .ok_or(ConnectionError::StateUnavailable)
    }

    pub async fn initialize(
        &self,
        request_timeout: Duration,
    ) -> Result<InitializeResponse, ConnectionError> {
        let params = InitializeParams {
            client_info: ClientInfo {
                name: "codeagent",
                title: Some("CodeAgent"),
                version: env!("CARGO_PKG_VERSION"),
            },
            capabilities: InitializeCapabilities {
                experimental_api: true,
                opt_out_notification_methods: IGNORED_NOTIFICATION_METHODS,
            },
        };
        let response = self.request("initialize", &params, request_timeout).await?;
        self.notify("initialized").await?;
        Ok(response)
    }

    pub async fn request<P, R>(
        &self,
        method: &str,
        params: &P,
        request_timeout: Duration,
    ) -> Result<R, ConnectionError>
    where
        P: Serialize,
        R: DeserializeOwned,
    {
        for delay in OVERLOAD_RETRY_DELAYS {
            match self.request_once(method, params, request_timeout).await {
                Err(ConnectionError::Request { code: -32001, .. }) => sleep(delay).await,
                result => {
                    record_rpc_error(method, &result);
                    return result;
                }
            }
        }
        let result = self.request_once(method, params, request_timeout).await;
        record_rpc_error(method, &result);
        result
    }

    async fn request_once<P, R>(
        &self,
        method: &str,
        params: &P,
        request_timeout: Duration,
    ) -> Result<R, ConnectionError>
    where
        P: Serialize,
        R: DeserializeOwned,
    {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let message = encode_request(id, method, params)?;
        let (sender, receiver) = oneshot::channel();

        self.pending
            .lock()
            .map_err(|_| ConnectionError::StateUnavailable)?
            .insert(id, sender);

        if let Err(error) = self.write_message(&message).await {
            self.remove_pending(id)?;
            return Err(error);
        }

        let response = match timeout(request_timeout, receiver).await {
            Ok(Ok(response)) => response,
            Ok(Err(_)) => return Err(ConnectionError::ConnectionClosed),
            Err(_) => {
                self.remove_pending(id)?;
                return Err(ConnectionError::Timeout);
            }
        };

        match response {
            Ok(result) => serde_json::from_str(result.get()).map_err(ConnectionError::Json),
            Err(PendingError::Request(error)) => Err(ConnectionError::Request {
                code: error.code,
                message: error.message,
            }),
            Err(PendingError::ConnectionClosed) => Err(ConnectionError::ConnectionClosed),
            Err(PendingError::InvalidMessage) => Err(ConnectionError::InvalidMessage),
        }
    }

    async fn notify(&self, method: &str) -> Result<(), ConnectionError> {
        let message = encode_notification(method)?;
        self.write_message(&message).await
    }

    pub async fn respond<R: Serialize>(&self, id: u64, result: &R) -> Result<(), ConnectionError> {
        let message = encode_response(id, result)?;
        self.write_message(&message).await
    }

    async fn write_message(&self, message: &[u8]) -> Result<(), ConnectionError> {
        let mut writer = self.writer.lock().await;
        writer.write_all(message).await?;
        writer.flush().await?;
        Ok(())
    }

    fn remove_pending(&self, id: u64) -> Result<(), ConnectionError> {
        self.pending
            .lock()
            .map_err(|_| ConnectionError::StateUnavailable)?
            .remove(&id);
        Ok(())
    }
}

fn record_rpc_error<T>(method: &str, result: &Result<T, ConnectionError>) {
    if let Err(ConnectionError::Request { code, message }) = result {
        diagnostics::record_codex_rpc_error(method, *code, message);
    }
}

impl Drop for AppServerConnection {
    fn drop(&mut self) {
        self.reader_task.abort();
    }
}

#[derive(Debug)]
pub(super) enum FrameReadError {
    Io(std::io::Error),
    TooLarge,
}

impl From<std::io::Error> for FrameReadError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

pub(super) async fn read_bounded_frame<R>(
    reader: &mut R,
    frame: &mut Vec<u8>,
    standard_limit: usize,
    image_limit: usize,
) -> Result<bool, FrameReadError>
where
    R: AsyncBufRead + Unpin,
{
    let mut is_image = false;
    let mut scan_from = 0;

    loop {
        let buffer = reader.fill_buf().await?;
        if buffer.is_empty() {
            return Ok(!frame.is_empty());
        }

        let newline = buffer.iter().position(|byte| *byte == b'\n');
        let data_len = newline.unwrap_or(buffer.len());
        let limit = if is_image {
            image_limit
        } else {
            standard_limit
        };
        // 只复制预算内字节，保证恶意无换行输入不会先触发超额扩容。
        let copy_len = data_len.min(limit.saturating_sub(frame.len()));
        frame.extend_from_slice(&buffer[..copy_len]);

        if !is_image && GeneratedImageStore::contains_image_generation(&frame[scan_from..]) {
            is_image = true;
        }
        scan_from = frame
            .len()
            .saturating_sub(GeneratedImageStore::marker_len().saturating_sub(1));
        reader.consume(copy_len);

        if copy_len < data_len {
            if is_image && frame.len() < image_limit {
                continue;
            }
            return Err(FrameReadError::TooLarge);
        }
        if newline.is_some() {
            reader.consume(1);
            return Ok(true);
        }
    }
}

async fn read_responses<R>(
    reader: R,
    pending: PendingRequests,
    server_messages: mpsc::Sender<ServerMessage>,
    image_store: Option<GeneratedImageStore>,
) where
    R: AsyncRead + Unpin,
{
    let mut reader = BufReader::new(reader);
    let mut line = Vec::with_capacity(8 * 1024);
    let mut queued_notifications = NotificationBuffer::new(NOTIFICATION_OVERFLOW_CAPACITY);

    loop {
        line.clear();
        let read_result = if queued_notifications.is_empty() {
            read_bounded_frame(
                &mut reader,
                &mut line,
                MAX_STANDARD_FRAME_BYTES,
                MAX_IMAGE_FRAME_BYTES,
            )
            .await
        } else {
            tokio::select! {
                biased;
                result = read_bounded_frame(
                    &mut reader,
                    &mut line,
                    MAX_STANDARD_FRAME_BYTES,
                    MAX_IMAGE_FRAME_BYTES,
                ) => result,
                permit = server_messages.reserve() => {
                    let Ok(permit) = permit else {
                        queued_notifications.clear();
                        continue;
                    };
                    permit.send(queued_notifications.pop_front().expect("queue is not empty"));
                    continue;
                }
            }
        };
        match read_result {
            Ok(false) => {
                fail_pending(&pending, PendingError::ConnectionClosed);
                // stdout 已关闭且不再有 response；尽量交付此前已接收的通知。
                while let Some(notification) = queued_notifications.pop_front() {
                    if server_messages.send(notification).await.is_err() {
                        break;
                    }
                }
                return;
            }
            Err(FrameReadError::Io(_error)) => {
                fail_pending(&pending, PendingError::ConnectionClosed);
                return;
            }
            Err(FrameReadError::TooLarge) => {
                fail_pending(&pending, PendingError::InvalidMessage);
                return;
            }
            Ok(true) => {}
        }

        while matches!(line.last(), Some(b'\r')) {
            line.pop();
        }
        if line.is_empty() {
            continue;
        }

        if let Some(store) = image_store.as_ref()
            && GeneratedImageStore::contains_image_generation(&line)
        {
            let store = store.clone();
            match tokio::task::spawn_blocking(move || store.sanitize_frame(line)).await {
                Ok(Ok(sanitized)) => line = sanitized,
                Ok(Err(_)) | Err(_) => {
                    fail_pending(&pending, PendingError::InvalidMessage);
                    return;
                }
            }
        }

        // 只解析响应信封，result 保持 RawValue，避免大响应在路由阶段重复建树。
        let mut message = match serde_json::from_slice::<IncomingMessage>(&line) {
            Ok(message) => message,
            Err(_) => {
                fail_pending(&pending, PendingError::InvalidMessage);
                return;
            }
        };
        if let Some(method) = message.method.take() {
            let Some(params) = message.params else {
                fail_pending(&pending, PendingError::InvalidMessage);
                return;
            };
            let mut notification = ServerMessage {
                id: message.id,
                method,
                params,
            };
            if queued_notifications.is_empty() {
                match server_messages.try_send(notification) {
                    Ok(()) => continue,
                    Err(mpsc::error::TrySendError::Full(returned)) => notification = returned,
                    Err(mpsc::error::TrySendError::Closed(_)) => continue,
                }
            }
            // channel 满时只淘汰可恢复 delta；生命周期与审批事实流必须完整保留。
            queued_notifications.push(notification);
            continue;
        }
        route_response(&pending, message);
    }
}

fn route_response(pending: &PendingRequests, message: IncomingMessage) {
    if message.method.is_some() {
        return;
    }
    let Some(id) = message.id else {
        return;
    };
    let sender = match pending.lock() {
        Ok(mut requests) => requests.remove(&id),
        Err(_) => None,
    };
    let Some(sender) = sender else {
        return;
    };

    let response = match (message.result, message.error) {
        (Some(result), _) => Ok(result),
        (_, Some(error)) => Err(PendingError::Request(error)),
        _ => Err(PendingError::InvalidMessage),
    };
    let _ = sender.send(response);
}

fn fail_pending(pending: &PendingRequests, error: PendingError) {
    let requests = match pending.lock() {
        Ok(mut requests) => std::mem::take(&mut *requests),
        Err(_) => return,
    };
    for sender in requests.into_values() {
        let _ = sender.send(Err(error.clone()));
    }
}
