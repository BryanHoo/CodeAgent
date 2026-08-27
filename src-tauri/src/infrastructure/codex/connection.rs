use std::{
    collections::HashMap,
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
    io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader},
    sync::{Mutex as AsyncMutex, mpsc, oneshot},
    task::JoinHandle,
    time::{sleep, timeout},
};

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
    pub fn new<R, W>(reader: R, writer: W) -> Self
    where
        R: AsyncRead + Send + Unpin + 'static,
        W: AsyncWrite + Send + Unpin + 'static,
    {
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let reader_pending = Arc::clone(&pending);
        let (message_sender, message_receiver) = mpsc::channel(256);
        let reader_task = tokio::spawn(read_responses(reader, reader_pending, message_sender));

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
                result => return result,
            }
        }
        self.request_once(method, params, request_timeout).await
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

impl Drop for AppServerConnection {
    fn drop(&mut self) {
        self.reader_task.abort();
    }
}

async fn read_responses<R>(
    reader: R,
    pending: PendingRequests,
    server_messages: mpsc::Sender<ServerMessage>,
) where
    R: AsyncRead + Unpin,
{
    let mut reader = BufReader::new(reader);
    let mut line = Vec::with_capacity(8 * 1024);

    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line).await {
            Ok(0) | Err(_) => {
                fail_pending(&pending, PendingError::ConnectionClosed);
                return;
            }
            Ok(_) => {}
        }

        while matches!(line.last(), Some(b'\n' | b'\r')) {
            line.pop();
        }
        if line.is_empty() {
            continue;
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
            // 有界队列为 WebView 短暂卡顿提供背压，同时不丢弃会改变状态的通知。
            let _ = server_messages
                .send(ServerMessage {
                    id: message.id,
                    method,
                    params,
                })
                .await;
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

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use serde_json::{Value, json};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

    use super::AppServerConnection;

    #[tokio::test]
    async fn initialize_should_complete_required_handshake() {
        let (client, server) = duplex(4096);
        let (client_reader, client_writer) = split(client);
        let (server_reader, mut server_writer) = split(server);
        let connection = AppServerConnection::new(client_reader, client_writer);

        let server_task = tokio::spawn(async move {
            let mut lines = BufReader::new(server_reader).lines();
            let request = lines
                .next_line()
                .await
                .expect("server should read request")
                .expect("initialize request should exist");
            let request: Value = serde_json::from_str(&request).expect("request should be JSON");
            assert_eq!(request["method"], "initialize");
            assert_eq!(request["params"]["clientInfo"]["name"], "codeagent");
            assert_eq!(request["params"]["capabilities"]["experimentalApi"], true);
            let opt_out = request["params"]["capabilities"]["optOutNotificationMethods"]
                .as_array()
                .expect("ignored notifications should be negotiated");
            assert!(opt_out.iter().any(|method| method == "turn/diff/updated"));
            assert!(
                !opt_out
                    .iter()
                    .any(|method| method == "thread/status/changed")
            );

            server_writer
                .write_all(
                    b"{\"id\":1,\"result\":{\"userAgent\":\"codex-cli\",\"codexHome\":\"/tmp/codex\",\"platformFamily\":\"unix\",\"platformOs\":\"macos\"}}\n",
                )
                .await
                .expect("server should write response");

            let notification = lines
                .next_line()
                .await
                .expect("server should read notification")
                .expect("initialized notification should exist");
            assert_eq!(notification, "{\"method\":\"initialized\"}");
        });

        let response = connection
            .initialize(Duration::from_secs(1))
            .await
            .expect("handshake should succeed");

        assert_eq!(response.user_agent, "codex-cli");
        assert_eq!(response.codex_home, "/tmp/codex");
        server_task.await.expect("fake server should finish");
    }

    #[tokio::test]
    async fn concurrent_requests_should_match_out_of_order_responses() {
        let (client, server) = duplex(4096);
        let (client_reader, client_writer) = split(client);
        let (server_reader, mut server_writer) = split(server);
        let connection = AppServerConnection::new(client_reader, client_writer);

        let server_task = tokio::spawn(async move {
            let mut lines = BufReader::new(server_reader).lines();
            let first: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            let second: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();

            let responses = format!(
                "{{\"id\":{},\"result\":{{\"value\":\"second\"}}}}\n{{\"id\":{},\"result\":{{\"value\":\"first\"}}}}\n",
                second["id"], first["id"]
            );
            server_writer.write_all(responses.as_bytes()).await.unwrap();
        });

        let first_params = json!({});
        let second_params = json!({});
        let first =
            connection.request::<_, Value>("test/first", &first_params, Duration::from_secs(1));
        let second =
            connection.request::<_, Value>("test/second", &second_params, Duration::from_secs(1));
        let (first, second) = tokio::join!(first, second);

        assert_eq!(first.unwrap()["value"], "first");
        assert_eq!(second.unwrap()["value"], "second");
        server_task.await.unwrap();
    }

    #[tokio::test]
    async fn notifications_should_be_available_without_blocking_responses() {
        let (client, server) = duplex(4096);
        let (client_reader, client_writer) = split(client);
        let (server_reader, mut server_writer) = split(server);
        let connection = AppServerConnection::new(client_reader, client_writer);
        let mut messages = connection
            .take_server_messages()
            .await
            .expect("message receiver should be available once");

        let server_task = tokio::spawn(async move {
            let mut lines = BufReader::new(server_reader).lines();
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            server_writer
                .write_all(
                    format!(
                        "{{\"method\":\"item/agentMessage/delta\",\"params\":{{\"threadId\":\"thread-a\",\"turnId\":\"turn-a\",\"itemId\":\"item-a\",\"delta\":\"ok\"}}}}\n{{\"id\":{},\"result\":{{\"done\":true}}}}\n",
                        request["id"]
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        });

        let response: Value = connection
            .request("test/request", &json!({}), Duration::from_secs(1))
            .await
            .expect("response should not wait for notification consumption");
        assert_eq!(response["done"], true);
        let message = messages
            .recv()
            .await
            .expect("notification should be routed");
        assert_eq!(message.method, "item/agentMessage/delta");
        assert_eq!(
            serde_json::from_str::<Value>(message.params.get()).unwrap()["delta"],
            "ok"
        );
        server_task.await.unwrap();
    }

    #[tokio::test]
    async fn server_request_id_should_not_consume_client_response() {
        let (client, server) = duplex(4096);
        let (client_reader, client_writer) = split(client);
        let (server_reader, mut server_writer) = split(server);
        let connection = AppServerConnection::new(client_reader, client_writer);

        let server_task = tokio::spawn(async move {
            let mut lines = BufReader::new(server_reader).lines();
            let request: Value = serde_json::from_str(
                &lines
                    .next_line()
                    .await
                    .expect("server should read request")
                    .expect("client request should exist"),
            )
            .expect("client request should be JSON");
            let id = &request["id"];
            let messages = format!(
                "{{\"id\":{id},\"method\":\"item/tool/requestUserInput\",\"params\":{{}}}}\n{{\"id\":{id},\"result\":{{\"value\":\"client-response\"}}}}\n"
            );
            server_writer
                .write_all(messages.as_bytes())
                .await
                .expect("server should write messages");
        });

        let result: Value = connection
            .request("test/collision", &json!({}), Duration::from_secs(1))
            .await
            .expect("server request must not consume the client response");

        assert_eq!(result["value"], "client-response");
        server_task.await.expect("fake server should finish");
    }
}
