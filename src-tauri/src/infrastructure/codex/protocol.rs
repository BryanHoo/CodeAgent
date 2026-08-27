use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInfo<'a> {
    pub name: &'a str,
    pub title: Option<&'a str>,
    pub version: &'a str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeCapabilities {
    pub experimental_api: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeParams<'a> {
    pub client_info: ClientInfo<'a>,
    pub capabilities: InitializeCapabilities,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResponse {
    pub user_agent: String,
    pub codex_home: String,
    pub platform_family: String,
    pub platform_os: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct IncomingMessage {
    pub id: Option<u64>,
    pub method: Option<String>,
    pub result: Option<Box<RawValue>>,
    pub error: Option<RpcError>,
}

#[derive(Serialize)]
struct Request<'a, P> {
    method: &'a str,
    id: u64,
    params: &'a P,
}

#[derive(Serialize)]
struct Notification<'a> {
    method: &'a str,
}

pub fn encode_request<P: Serialize>(
    id: u64,
    method: &str,
    params: &P,
) -> Result<Vec<u8>, serde_json::Error> {
    let mut message = Vec::with_capacity(256);
    serde_json::to_writer(&mut message, &Request { method, id, params })?;
    // stdio 传输以换行划分消息，集中编码可避免多次小块写入。
    message.push(b'\n');
    Ok(message)
}

pub fn encode_notification(method: &str) -> Result<Vec<u8>, serde_json::Error> {
    let mut message = Vec::with_capacity(64);
    serde_json::to_writer(&mut message, &Notification { method })?;
    message.push(b'\n');
    Ok(message)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        ClientInfo, InitializeCapabilities, InitializeParams, encode_notification, encode_request,
    };

    #[test]
    fn initialize_request_should_match_codex_schema() {
        let params = InitializeParams {
            client_info: ClientInfo {
                name: "codeagent",
                title: Some("CodeAgent"),
                version: "0.1.0",
            },
            capabilities: InitializeCapabilities {
                experimental_api: true,
            },
        };

        let message = encode_request(1, "initialize", &params).expect("request should serialize");

        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&message).expect("request should be JSON"),
            json!({
                "method": "initialize",
                "id": 1,
                "params": {
                    "clientInfo": {
                        "name": "codeagent",
                        "title": "CodeAgent",
                        "version": "0.1.0"
                    },
                    "capabilities": {
                        "experimentalApi": true
                    }
                }
            })
        );
        assert_eq!(message.last(), Some(&b'\n'));
    }

    #[test]
    fn initialized_notification_should_omit_empty_params() {
        let message = encode_notification("initialized").expect("notification should serialize");

        assert_eq!(message, b"{\"method\":\"initialized\"}\n");
    }
}
