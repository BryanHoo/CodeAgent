//! Codex App Server JSONL 双向 RPC 客户端。
//!
//! 语义对齐 TypeScript `JsonlRpcClient`：按行分帧（兼容 `\r\n` 与跨块缓冲）、
//! 单调数字 id 关联、绝对超时、`-32001` 显式未入队重试、畸形帧即整体失败。

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

/// 原生 imageGeneration 会把图片 Base64 放进单帧，64 MiB 覆盖最大图片并保留协议边界。
pub const DEFAULT_MAX_JSONL_BYTES: usize = 64 * 1024 * 1024;

const READ_CHUNK_BYTES: usize = 64 * 1024;
const WRITE_QUEUE_CAPACITY: usize = 64;
const ERROR_QUEUE_CAPACITY: usize = 8;

/// `-32001` 显式未入队错误的指数退避策略。
#[derive(Clone, Copy, Debug)]
pub struct OverloadRetryPolicy {
    pub base_delay: Duration,
    pub max_delay: Duration,
    pub max_elapsed: Duration,
    pub max_retries: u32,
}

impl Default for OverloadRetryPolicy {
    fn default() -> Self {
        Self {
            base_delay: Duration::from_millis(100),
            max_delay: Duration::from_millis(2_000),
            max_elapsed: Duration::from_millis(5_000),
            max_retries: 4,
        }
    }
}

impl OverloadRetryPolicy {
    /// 计算下一次重试延迟；预算耗尽时返回 `None`。
    /// 桌面单客户端场景使用确定性中点抖动（等价 TS 公式 sample=0.5）。
    fn retry_delay(&self, retry_count: u32, elapsed: Duration) -> Option<Duration> {
        if retry_count >= self.max_retries || elapsed >= self.max_elapsed {
            return None;
        }
        let exponent = retry_count.min(30);
        let exponential = self
            .base_delay
            .saturating_mul(2_u32.saturating_pow(exponent))
            .min(self.max_delay)
            .max(Duration::from_millis(1));
        (elapsed + exponential <= self.max_elapsed).then_some(exponential)
    }
}

/// JSONL RPC 客户端选项。
#[derive(Clone, Copy, Debug)]
pub struct JsonlRpcClientOptions {
    /// 输入流正常结束时是否关闭客户端；进程宿主自行处理退出时设为 `false`。
    pub close_on_input_end: bool,
    pub default_timeout: Duration,
    /// 通知与服务端请求通道容量；读取任务在消费者滞后时施加背压。
    pub incoming_capacity: usize,
    pub max_buffer_bytes: usize,
    pub max_frame_bytes: usize,
    pub overload_retry: OverloadRetryPolicy,
}

impl Default for JsonlRpcClientOptions {
    fn default() -> Self {
        Self {
            close_on_input_end: true,
            default_timeout: Duration::from_secs(30),
            incoming_capacity: 256,
            max_buffer_bytes: DEFAULT_MAX_JSONL_BYTES,
            max_frame_bytes: DEFAULT_MAX_JSONL_BYTES,
            overload_retry: OverloadRetryPolicy::default(),
        }
    }
}

/// RPC 客户端错误。
#[derive(Clone, Debug, thiserror::Error)]
pub enum RpcClientError {
    #[error("RPC connection is closed: {0}")]
    ConnectionClosed(String),
    #[error("RPC protocol error: {0}")]
    Protocol(String),
    #[error("RPC request {method} failed with code {code}: {message}")]
    Response {
        code: i64,
        data: Value,
        message: String,
        method: String,
    },
    #[error("RPC request {method} ({id}) timed out after {timeout_ms}ms")]
    Timeout {
        id: u64,
        method: String,
        timeout_ms: u128,
    },
}

/// Codex 主动推送的通知。
#[derive(Clone, Debug, PartialEq)]
pub struct RpcNotification {
    pub method: String,
    pub params: Value,
}

/// Codex 发起的双向请求（审批、用户输入等）。
#[derive(Clone, Debug, PartialEq)]
pub struct RpcServerRequest {
    pub id: Value,
    pub method: String,
    pub params: Value,
}

/// 客户端入站流；全部为有界通道。
pub struct RpcIncoming {
    pub errors: mpsc::Receiver<RpcClientError>,
    pub notifications: mpsc::Receiver<RpcNotification>,
    pub server_requests: mpsc::Receiver<RpcServerRequest>,
}

/// 读写后台任务句柄；关闭后可有界等待回收。
pub struct RpcWorkers {
    reader: JoinHandle<()>,
    writer: JoinHandle<()>,
}

impl RpcWorkers {
    /// 等待读写任务结束；必须在取消后调用，等待时间有界。
    pub async fn join(self) {
        let _ = self.reader.await;
        let _ = self.writer.await;
    }
}

struct PendingEntry {
    method: String,
    request_frame: Value,
    responder: oneshot::Sender<Result<Value, RpcClientError>>,
    retry_count: u32,
    retry_scheduled: bool,
    started_at: Instant,
}

struct PendingState {
    closed: Option<RpcClientError>,
    entries: HashMap<u64, PendingEntry>,
}

struct RpcShared {
    default_timeout: Duration,
    error_tx: mpsc::Sender<RpcClientError>,
    next_id: AtomicU64,
    overload_retry: OverloadRetryPolicy,
    pending: Mutex<PendingState>,
    shutdown: CancellationToken,
    write_tx: mpsc::Sender<Vec<u8>>,
}

impl RpcShared {
    fn closed_reason(&self) -> Option<RpcClientError> {
        self.pending
            .lock()
            .map(|state| state.closed.clone())
            .unwrap_or_else(|_| {
                Some(RpcClientError::ConnectionClosed(
                    "RPC state is poisoned".to_string(),
                ))
            })
    }

    /// 已关闭客户端上的新操作统一返回连接关闭错误，保留原始原因描述。
    fn closed_error(&self) -> RpcClientError {
        match self.closed_reason() {
            Some(RpcClientError::ConnectionClosed(message)) => {
                RpcClientError::ConnectionClosed(message)
            }
            Some(other) => RpcClientError::ConnectionClosed(other.to_string()),
            None => RpcClientError::ConnectionClosed("RPC connection is closed".to_string()),
        }
    }

    /// 以给定原因关闭：拒绝全部 pending 并取消后台任务。
    fn close_with(&self, reason: RpcClientError) {
        let entries = {
            let Ok(mut state) = self.pending.lock() else {
                self.shutdown.cancel();
                return;
            };
            if state.closed.is_some() {
                return;
            }
            state.closed = Some(reason.clone());
            state.entries.drain().collect::<Vec<_>>()
        };
        for (_, entry) in entries {
            let _ = entry.responder.send(Err(reason.clone()));
        }
        self.shutdown.cancel();
    }

    /// 协议或流故障：先向观察者发布错误，再整体关闭。
    fn fail(&self, error: RpcClientError) {
        if self.closed_reason().is_some() {
            return;
        }
        let _ = self.error_tx.try_send(error.clone());
        self.close_with(error);
    }
}

/// JSONL RPC 客户端句柄；可克隆共享。
#[derive(Clone)]
pub struct JsonlRpcClient {
    shared: Arc<RpcShared>,
}

impl JsonlRpcClient {
    /// 在当前 Tokio 运行时上启动读写任务并返回客户端。
    pub fn spawn(
        input: impl AsyncRead + Send + Unpin + 'static,
        output: impl AsyncWrite + Send + Unpin + 'static,
        options: JsonlRpcClientOptions,
    ) -> (Self, RpcIncoming, RpcWorkers) {
        let (write_tx, write_rx) = mpsc::channel::<Vec<u8>>(WRITE_QUEUE_CAPACITY);
        let (error_tx, error_rx) = mpsc::channel(ERROR_QUEUE_CAPACITY);
        let (notification_tx, notification_rx) = mpsc::channel(options.incoming_capacity);
        let (server_request_tx, server_request_rx) = mpsc::channel(options.incoming_capacity);

        let shared = Arc::new(RpcShared {
            default_timeout: options.default_timeout,
            error_tx,
            next_id: AtomicU64::new(1),
            overload_retry: options.overload_retry,
            pending: Mutex::new(PendingState {
                closed: None,
                entries: HashMap::new(),
            }),
            shutdown: CancellationToken::new(),
            write_tx,
        });

        let reader = tokio::spawn(run_reader(
            Arc::clone(&shared),
            input,
            options,
            notification_tx,
            server_request_tx,
        ));
        let writer = tokio::spawn(run_writer(
            Arc::clone(&shared),
            output,
            write_rx,
            options.default_timeout,
        ));

        (
            Self { shared },
            RpcIncoming {
                errors: error_rx,
                notifications: notification_rx,
                server_requests: server_request_rx,
            },
            RpcWorkers { reader, writer },
        )
    }

    /// 返回客户端是否已关闭。
    #[must_use]
    pub fn is_closed(&self) -> bool {
        self.shared.closed_reason().is_some()
    }

    /// 返回关闭原因。
    #[must_use]
    pub fn closed_reason(&self) -> Option<RpcClientError> {
        self.shared.closed_reason()
    }

    /// 主动关闭客户端并拒绝全部 pending 请求。
    pub fn close(&self, reason: Option<RpcClientError>) {
        self.shared.close_with(reason.unwrap_or_else(|| {
            RpcClientError::ConnectionClosed("RPC connection is closed".to_string())
        }));
    }

    /// 使用默认超时发起请求。
    pub async fn request(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value, RpcClientError> {
        self.request_with_timeout(method, params, self.shared.default_timeout)
            .await
    }

    /// 发起请求；超时为从创建起的绝对时限，重试不重置。
    pub async fn request_with_timeout(
        &self,
        method: &str,
        params: Option<Value>,
        timeout: Duration,
    ) -> Result<Value, RpcClientError> {
        let id = self.shared.next_id.fetch_add(1, Ordering::Relaxed);
        let mut request_frame = json!({ "id": id, "method": method });
        if let Some(params) = params {
            request_frame["params"] = params;
        }

        let (responder, receiver) = oneshot::channel();
        {
            let mut state =
                self.shared.pending.lock().map_err(|_| {
                    RpcClientError::ConnectionClosed("RPC state is poisoned".into())
                })?;
            if state.closed.is_some() {
                drop(state);
                return Err(self.shared.closed_error());
            }
            state.entries.insert(
                id,
                PendingEntry {
                    method: method.to_string(),
                    request_frame: request_frame.clone(),
                    responder,
                    retry_count: 0,
                    retry_scheduled: false,
                    started_at: Instant::now(),
                },
            );
        }

        if let Err(error) = self.send_frame(&request_frame).await {
            self.remove_pending(id);
            return Err(error);
        }

        match tokio::time::timeout(timeout, receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(self.shared.closed_reason().unwrap_or_else(|| {
                RpcClientError::ConnectionClosed("RPC responder dropped".to_string())
            })),
            Err(_) => {
                self.remove_pending(id);
                Err(RpcClientError::Timeout {
                    id,
                    method: method.to_string(),
                    timeout_ms: timeout.as_millis(),
                })
            }
        }
    }

    /// 发送无响应通知。
    pub async fn notify(&self, method: &str, params: Option<Value>) -> Result<(), RpcClientError> {
        let mut frame = json!({ "method": method });
        if let Some(params) = params {
            frame["params"] = params;
        }
        self.send_frame(&frame).await
    }

    /// 应答 Codex 发起的服务端请求。
    pub async fn respond_to_server_request(
        &self,
        id: Value,
        result: Value,
    ) -> Result<(), RpcClientError> {
        require_request_id(&id)?;
        self.send_frame(&json!({ "id": id, "result": result }))
            .await
    }

    /// 拒绝 Codex 发起的服务端请求。
    pub async fn reject_server_request(
        &self,
        id: Value,
        code: i64,
        message: &str,
    ) -> Result<(), RpcClientError> {
        require_request_id(&id)?;
        self.send_frame(&json!({ "id": id, "error": { "code": code, "message": message } }))
            .await
    }

    async fn send_frame(&self, frame: &Value) -> Result<(), RpcClientError> {
        if self.shared.closed_reason().is_some() {
            return Err(self.shared.closed_error());
        }
        let mut bytes = serde_json::to_vec(frame).map_err(|error| {
            RpcClientError::Protocol(format!("serialize frame failed: {error}"))
        })?;
        bytes.push(b'\n');
        self.shared.write_tx.send(bytes).await.map_err(|_| {
            self.shared.closed_reason().unwrap_or_else(|| {
                RpcClientError::ConnectionClosed("RPC writer is unavailable".to_string())
            })
        })
    }

    fn remove_pending(&self, id: u64) {
        if let Ok(mut state) = self.shared.pending.lock() {
            state.entries.remove(&id);
        }
    }
}

fn require_request_id(id: &Value) -> Result<(), RpcClientError> {
    if id.is_string() || id.is_number() {
        Ok(())
    } else {
        Err(RpcClientError::Protocol(
            "RPC request id must be a string or finite number".to_string(),
        ))
    }
}

async fn run_writer(
    shared: Arc<RpcShared>,
    mut output: impl AsyncWrite + Send + Unpin + 'static,
    mut write_rx: mpsc::Receiver<Vec<u8>>,
    write_timeout: Duration,
) {
    loop {
        let frame = tokio::select! {
            () = shared.shutdown.cancelled() => break,
            frame = write_rx.recv() => frame,
        };
        let Some(frame) = frame else { break };
        let write = async {
            output.write_all(&frame).await?;
            output.flush().await
        };
        match tokio::time::timeout(write_timeout, write).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                shared.fail(RpcClientError::ConnectionClosed(format!(
                    "RPC write failed: {error}"
                )));
                break;
            }
            Err(_) => {
                shared.fail(RpcClientError::ConnectionClosed(format!(
                    "RPC write timed out after {}ms",
                    write_timeout.as_millis()
                )));
                break;
            }
        }
    }
    // 任务结束时丢弃 output，关闭子进程 stdin 以请求正常退出。
}

async fn run_reader(
    shared: Arc<RpcShared>,
    mut input: impl AsyncRead + Send + Unpin + 'static,
    options: JsonlRpcClientOptions,
    notification_tx: mpsc::Sender<RpcNotification>,
    server_request_tx: mpsc::Sender<RpcServerRequest>,
) {
    let mut chunk = vec![0_u8; READ_CHUNK_BYTES];
    let mut buffer: Vec<u8> = Vec::new();

    loop {
        let read = tokio::select! {
            () = shared.shutdown.cancelled() => break,
            read = input.read(&mut chunk) => read,
        };
        match read {
            Ok(0) => {
                if buffer.iter().any(|byte| !byte.is_ascii_whitespace()) {
                    shared.fail(RpcClientError::Protocol(format!(
                        "RPC input ended with an incomplete JSONL frame ({} bytes)",
                        buffer.len()
                    )));
                } else if options.close_on_input_end {
                    shared.close_with(RpcClientError::ConnectionClosed(
                        "RPC input stream ended".to_string(),
                    ));
                }
                break;
            }
            Ok(read) => {
                if !process_chunk(
                    &shared,
                    &options,
                    &mut buffer,
                    &chunk[..read],
                    &notification_tx,
                    &server_request_tx,
                )
                .await
                {
                    break;
                }
            }
            Err(error) => {
                shared.fail(RpcClientError::ConnectionClosed(format!(
                    "RPC stream failed: {error}"
                )));
                break;
            }
        }
    }
}

async fn process_chunk(
    shared: &Arc<RpcShared>,
    options: &JsonlRpcClientOptions,
    buffer: &mut Vec<u8>,
    mut input: &[u8],
    notification_tx: &mpsc::Sender<RpcNotification>,
    server_request_tx: &mpsc::Sender<RpcServerRequest>,
) -> bool {
    while let Some(newline_index) = input.iter().position(|byte| *byte == b'\n') {
        let chunk_frame = &input[..newline_index];
        input = &input[newline_index + 1..];

        let frame_bytes = buffer.len() + chunk_frame.len();
        if frame_bytes > options.max_frame_bytes {
            shared.fail(oversized_frame_error(options.max_frame_bytes, frame_bytes));
            return false;
        }

        let mut frame: Vec<u8> = if buffer.is_empty() {
            chunk_frame.to_vec()
        } else {
            let mut merged = std::mem::take(buffer);
            merged.extend_from_slice(chunk_frame);
            merged
        };
        if frame.last() == Some(&b'\r') {
            frame.pop();
        }
        if frame.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        if let Err(error) = handle_frame(shared, &frame, notification_tx, server_request_tx).await {
            shared.fail(error);
            return false;
        }
    }

    let buffered_bytes = buffer.len() + input.len();
    if buffered_bytes > options.max_buffer_bytes {
        shared.fail(RpcClientError::Protocol(format!(
            "RPC unfinished JSONL buffer exceeds {} bytes ({} bytes)",
            options.max_buffer_bytes, buffered_bytes
        )));
        return false;
    }
    if buffered_bytes > options.max_frame_bytes {
        shared.fail(oversized_frame_error(
            options.max_frame_bytes,
            buffered_bytes,
        ));
        return false;
    }
    buffer.extend_from_slice(input);
    true
}

fn oversized_frame_error(limit: usize, actual: usize) -> RpcClientError {
    RpcClientError::Protocol(format!(
        "RPC JSONL frame exceeds {limit} bytes ({actual} bytes)"
    ))
}

async fn handle_frame(
    shared: &Arc<RpcShared>,
    frame: &[u8],
    notification_tx: &mpsc::Sender<RpcNotification>,
    server_request_tx: &mpsc::Sender<RpcServerRequest>,
) -> Result<(), RpcClientError> {
    let message: Value = serde_json::from_slice(frame).map_err(|_| {
        // 不透传原始输入内容，只记录安全的帧元数据。
        RpcClientError::Protocol(format!(
            "Invalid JSONL frame ({} bytes; JSON parse failed)",
            frame.len()
        ))
    })?;
    if !message.is_object() {
        return Err(RpcClientError::Protocol(
            "RPC frame must be a JSON object".to_string(),
        ));
    }

    let id = message.get("id");
    let method = message.get("method").and_then(Value::as_str);
    let has_result = message.get("result").is_some();
    let has_error = message.get("error").is_some();

    if let Some(id) = id.and_then(Value::as_u64)
        && (has_result || has_error)
    {
        return handle_response(shared, id, &message);
    }
    if let Some(id) = id
        && (id.is_string() || id.is_number())
        && let Some(method) = method
        && !has_result
        && !has_error
    {
        // 有界通道；消费者滞后时读取任务在此等待形成背压。
        let _ = server_request_tx
            .send(RpcServerRequest {
                id: id.clone(),
                method: method.to_string(),
                params: message.get("params").cloned().unwrap_or(Value::Null),
            })
            .await;
        return Ok(());
    }
    if id.is_none()
        && let Some(method) = method
    {
        let _ = notification_tx
            .send(RpcNotification {
                method: method.to_string(),
                params: message.get("params").cloned().unwrap_or(Value::Null),
            })
            .await;
        return Ok(());
    }

    Err(RpcClientError::Protocol(
        "RPC frame is neither a response, server request, nor notification".to_string(),
    ))
}

fn handle_response(
    shared: &Arc<RpcShared>,
    id: u64,
    message: &Value,
) -> Result<(), RpcClientError> {
    let mut state = shared
        .pending
        .lock()
        .map_err(|_| RpcClientError::Protocol("RPC state is poisoned".to_string()))?;
    if !state.entries.contains_key(&id) {
        // 迟到或未知响应静默忽略，与 TS 行为一致。
        return Ok(());
    }

    if let Some(error_value) = message.get("error") {
        let (Some(code), Some(error_message)) = (
            error_value.get("code").and_then(Value::as_i64),
            error_value.get("message").and_then(Value::as_str),
        ) else {
            return Err(RpcClientError::Protocol(
                "RPC error response has an invalid error payload".to_string(),
            ));
        };
        let data = error_value.get("data").cloned().unwrap_or(Value::Null);

        let explicitly_unqueued = code == -32001 && data.get("retry") == Some(&Value::Bool(true));
        if explicitly_unqueued && schedule_overload_retry(shared, &mut state, id) {
            return Ok(());
        }

        if let Some(entry) = state.entries.remove(&id) {
            let _ = entry.responder.send(Err(RpcClientError::Response {
                code,
                data,
                message: error_message.to_string(),
                method: entry.method,
            }));
        }
        return Ok(());
    }

    if message.get("result").is_none() {
        return Err(RpcClientError::Protocol(
            "RPC response is missing result or error".to_string(),
        ));
    }
    if let Some(entry) = state.entries.remove(&id) {
        let result = message.get("result").cloned().unwrap_or(Value::Null);
        let _ = entry.responder.send(Ok(result));
    }
    Ok(())
}

/// 为显式未入队的请求安排重发；返回是否已进入重试流程。
fn schedule_overload_retry(shared: &Arc<RpcShared>, state: &mut PendingState, id: u64) -> bool {
    let Some(entry) = state.entries.get_mut(&id) else {
        return false;
    };
    if entry.retry_scheduled {
        // 已有重试计划时忽略重复的过载响应。
        return true;
    }
    let Some(delay) = shared
        .overload_retry
        .retry_delay(entry.retry_count, entry.started_at.elapsed())
    else {
        return false;
    };
    entry.retry_count += 1;
    entry.retry_scheduled = true;
    let frame = entry.request_frame.clone();
    let retry_shared = Arc::clone(shared);
    tokio::spawn(async move {
        tokio::select! {
            () = retry_shared.shutdown.cancelled() => return,
            () = tokio::time::sleep(delay) => {}
        }
        let frame_bytes = {
            let Ok(mut state) = retry_shared.pending.lock() else {
                return;
            };
            if state.closed.is_some() {
                return;
            }
            let Some(entry) = state.entries.get_mut(&id) else {
                return;
            };
            entry.retry_scheduled = false;
            let mut bytes = match serde_json::to_vec(&frame) {
                Ok(bytes) => bytes,
                Err(_) => return,
            };
            bytes.push(b'\n');
            bytes
        };
        let _ = retry_shared.write_tx.send(frame_bytes).await;
    });
    true
}
