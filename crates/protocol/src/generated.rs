// 此文件由 `pnpm run protocol:rust:generate` 生成，请勿手工修改。

/// Error types.
pub mod error {
    /// Error from a `TryFrom` or `FromStr` implementation.
    pub struct ConversionError(::std::borrow::Cow<'static, str>);
    impl ::std::error::Error for ConversionError {}
    impl ::std::fmt::Display for ConversionError {
        fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> Result<(), ::std::fmt::Error> {
            ::std::fmt::Display::fmt(&self.0, f)
        }
    }
    impl ::std::fmt::Debug for ConversionError {
        fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> Result<(), ::std::fmt::Error> {
            ::std::fmt::Debug::fmt(&self.0, f)
        }
    }
    impl From<&'static str> for ConversionError {
        fn from(value: &'static str) -> Self {
            Self(value.into())
        }
    }
    impl From<String> for ConversionError {
        fn from(value: String) -> Self {
            Self(value.into())
        }
    }
}
///`AgentCapabilities`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "feedback",
///    "provider",
///    "skills",
///    "tasks",
///    "turns"
///  ],
///  "properties": {
///    "feedback": {
///      "type": "object",
///      "required": [
///        "upload"
///      ],
///      "properties": {
///        "upload": {
///          "type": "boolean"
///        }
///      },
///      "additionalProperties": false
///    },
///    "provider": {
///      "type": "string",
///      "minLength": 1
///    },
///    "skills": {
///      "type": "object",
///      "required": [
///        "list",
///        "use"
///      ],
///      "properties": {
///        "list": {
///          "type": "boolean"
///        },
///        "use": {
///          "type": "boolean"
///        }
///      },
///      "additionalProperties": false
///    },
///    "tasks": {
///      "type": "object",
///      "required": [
///        "fork",
///        "list",
///        "read",
///        "start"
///      ],
///      "properties": {
///        "fork": {
///          "type": "boolean"
///        },
///        "list": {
///          "type": "boolean"
///        },
///        "read": {
///          "type": "boolean"
///        },
///        "start": {
///          "type": "boolean"
///        }
///      },
///      "additionalProperties": false
///    },
///    "turns": {
///      "type": "object",
///      "required": [
///        "compact",
///        "interrupt",
///        "review",
///        "start",
///        "steer"
///      ],
///      "properties": {
///        "compact": {
///          "type": "boolean"
///        },
///        "interrupt": {
///          "type": "boolean"
///        },
///        "review": {
///          "type": "boolean"
///        },
///        "start": {
///          "type": "boolean"
///        },
///        "steer": {
///          "type": "boolean"
///        }
///      },
///      "additionalProperties": false
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct AgentCapabilities {
    pub feedback: AgentCapabilitiesFeedback,
    pub provider: AgentCapabilitiesProvider,
    pub skills: AgentCapabilitiesSkills,
    pub tasks: AgentCapabilitiesTasks,
    pub turns: AgentCapabilitiesTurns,
}
///`AgentCapabilitiesFeedback`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "upload"
///  ],
///  "properties": {
///    "upload": {
///      "type": "boolean"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct AgentCapabilitiesFeedback {
    pub upload: bool,
}
///`AgentCapabilitiesProvider`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct AgentCapabilitiesProvider(::std::string::String);
impl ::std::ops::Deref for AgentCapabilitiesProvider {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentCapabilitiesProvider> for ::std::string::String {
    fn from(value: AgentCapabilitiesProvider) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentCapabilitiesProvider {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentCapabilitiesProvider {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentCapabilitiesProvider {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentCapabilitiesProvider {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentCapabilitiesProvider {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`AgentCapabilitiesSkills`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "list",
///    "use"
///  ],
///  "properties": {
///    "list": {
///      "type": "boolean"
///    },
///    "use": {
///      "type": "boolean"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct AgentCapabilitiesSkills {
    pub list: bool,
    #[serde(rename = "use")]
    pub use_: bool,
}
///`AgentCapabilitiesTasks`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "fork",
///    "list",
///    "read",
///    "start"
///  ],
///  "properties": {
///    "fork": {
///      "type": "boolean"
///    },
///    "list": {
///      "type": "boolean"
///    },
///    "read": {
///      "type": "boolean"
///    },
///    "start": {
///      "type": "boolean"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct AgentCapabilitiesTasks {
    pub fork: bool,
    pub list: bool,
    pub read: bool,
    pub start: bool,
}
///`AgentCapabilitiesTurns`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "compact",
///    "interrupt",
///    "review",
///    "start",
///    "steer"
///  ],
///  "properties": {
///    "compact": {
///      "type": "boolean"
///    },
///    "interrupt": {
///      "type": "boolean"
///    },
///    "review": {
///      "type": "boolean"
///    },
///    "start": {
///      "type": "boolean"
///    },
///    "steer": {
///      "type": "boolean"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct AgentCapabilitiesTurns {
    pub compact: bool,
    pub interrupt: bool,
    pub review: bool,
    pub start: bool,
    pub steer: bool,
}
///`AgentTaskSettings`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "object",
///      "required": [
///        "approvalPolicy",
///        "approvalsReviewer",
///        "model",
///        "reasoningEffort",
///        "sandboxMode"
///      ],
///      "properties": {
///        "approvalPolicy": {
///          "oneOf": [
///            {
///              "type": "string",
///              "const": "untrusted"
///            },
///            {
///              "type": "string",
///              "const": "on-request"
///            },
///            {
///              "type": "string",
///              "const": "never"
///            }
///          ]
///        },
///        "approvalsReviewer": {
///          "type": "string",
///          "const": "user"
///        },
///        "model": {
///          "type": "string",
///          "minLength": 1
///        },
///        "reasoningEffort": {
///          "type": "string",
///          "minLength": 1
///        },
///        "sandboxMode": {
///          "oneOf": [
///            {
///              "type": "string",
///              "const": "read-only"
///            },
///            {
///              "type": "string",
///              "const": "workspace-write"
///            },
///            {
///              "type": "string",
///              "const": "danger-full-access"
///            }
///          ]
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "approvalPolicy",
///        "approvalsReviewer",
///        "model",
///        "reasoningEffort",
///        "sandboxMode"
///      ],
///      "properties": {
///        "approvalPolicy": {
///          "type": "string",
///          "const": "on-request"
///        },
///        "approvalsReviewer": {
///          "type": "string",
///          "const": "auto_review"
///        },
///        "model": {
///          "type": "string",
///          "minLength": 1
///        },
///        "reasoningEffort": {
///          "type": "string",
///          "minLength": 1
///        },
///        "sandboxMode": {
///          "oneOf": [
///            {
///              "type": "string",
///              "const": "read-only"
///            },
///            {
///              "type": "string",
///              "const": "workspace-write"
///            },
///            {
///              "type": "string",
///              "const": "danger-full-access"
///            }
///          ]
///        }
///      },
///      "additionalProperties": false
///    }
///  ]
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(tag = "approvalsReviewer", deny_unknown_fields)]
pub enum AgentTaskSettings {
    #[serde(rename = "user")]
    User {
        #[serde(rename = "approvalPolicy")]
        approval_policy: AgentTaskSettingsApprovalPolicy,
        model: AgentTaskSettingsModel,
        #[serde(rename = "reasoningEffort")]
        reasoning_effort: AgentTaskSettingsReasoningEffort,
        #[serde(rename = "sandboxMode")]
        sandbox_mode: AgentTaskSettingsSandboxMode,
    },
    #[serde(rename = "auto_review")]
    AutoReview {
        #[serde(rename = "approvalPolicy")]
        approval_policy: ::std::string::String,
        model: AgentTaskSettingsModel,
        #[serde(rename = "reasoningEffort")]
        reasoning_effort: AgentTaskSettingsReasoningEffort,
        #[serde(rename = "sandboxMode")]
        sandbox_mode: AgentTaskSettingsSandboxMode,
    },
}
///`AgentTaskSettingsApprovalPolicy`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "string",
///      "const": "untrusted"
///    },
///    {
///      "type": "string",
///      "const": "on-request"
///    },
///    {
///      "type": "string",
///      "const": "never"
///    }
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum AgentTaskSettingsApprovalPolicy {
    #[serde(rename = "untrusted")]
    Untrusted,
    #[serde(rename = "on-request")]
    OnRequest,
    #[serde(rename = "never")]
    Never,
}
impl ::std::fmt::Display for AgentTaskSettingsApprovalPolicy {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Untrusted => f.write_str("untrusted"),
            Self::OnRequest => f.write_str("on-request"),
            Self::Never => f.write_str("never"),
        }
    }
}
impl ::std::str::FromStr for AgentTaskSettingsApprovalPolicy {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "untrusted" => Ok(Self::Untrusted),
            "on-request" => Ok(Self::OnRequest),
            "never" => Ok(Self::Never),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for AgentTaskSettingsApprovalPolicy {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentTaskSettingsApprovalPolicy {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentTaskSettingsApprovalPolicy {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`AgentTaskSettingsModel`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct AgentTaskSettingsModel(::std::string::String);
impl ::std::ops::Deref for AgentTaskSettingsModel {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentTaskSettingsModel> for ::std::string::String {
    fn from(value: AgentTaskSettingsModel) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentTaskSettingsModel {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentTaskSettingsModel {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentTaskSettingsModel {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentTaskSettingsModel {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentTaskSettingsModel {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`AgentTaskSettingsReasoningEffort`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct AgentTaskSettingsReasoningEffort(::std::string::String);
impl ::std::ops::Deref for AgentTaskSettingsReasoningEffort {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentTaskSettingsReasoningEffort> for ::std::string::String {
    fn from(value: AgentTaskSettingsReasoningEffort) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentTaskSettingsReasoningEffort {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentTaskSettingsReasoningEffort {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentTaskSettingsReasoningEffort {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentTaskSettingsReasoningEffort {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentTaskSettingsReasoningEffort {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`AgentTaskSettingsSandboxMode`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "string",
///      "const": "read-only"
///    },
///    {
///      "type": "string",
///      "const": "workspace-write"
///    },
///    {
///      "type": "string",
///      "const": "danger-full-access"
///    }
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum AgentTaskSettingsSandboxMode {
    #[serde(rename = "read-only")]
    ReadOnly,
    #[serde(rename = "workspace-write")]
    WorkspaceWrite,
    #[serde(rename = "danger-full-access")]
    DangerFullAccess,
}
impl ::std::fmt::Display for AgentTaskSettingsSandboxMode {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::ReadOnly => f.write_str("read-only"),
            Self::WorkspaceWrite => f.write_str("workspace-write"),
            Self::DangerFullAccess => f.write_str("danger-full-access"),
        }
    }
}
impl ::std::str::FromStr for AgentTaskSettingsSandboxMode {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "read-only" => Ok(Self::ReadOnly),
            "workspace-write" => Ok(Self::WorkspaceWrite),
            "danger-full-access" => Ok(Self::DangerFullAccess),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for AgentTaskSettingsSandboxMode {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentTaskSettingsSandboxMode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentTaskSettingsSandboxMode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`CodeAgentError`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "code",
///    "message"
///  ],
///  "properties": {
///    "code": {
///      "oneOf": [
///        {
///          "type": "string",
///          "const": "cancelled"
///        },
///        {
///          "type": "string",
///          "const": "capacity_exceeded"
///        },
///        {
///          "type": "string",
///          "const": "conflict"
///        },
///        {
///          "type": "string",
///          "const": "internal"
///        },
///        {
///          "type": "string",
///          "const": "invalid_input"
///        },
///        {
///          "type": "string",
///          "const": "not_found"
///        },
///        {
///          "type": "string",
///          "const": "provider_failure"
///        },
///        {
///          "type": "string",
///          "const": "shutting_down"
///        },
///        {
///          "type": "string",
///          "const": "timeout"
///        }
///      ]
///    },
///    "correlationId": {
///      "type": "string",
///      "minLength": 1
///    },
///    "message": {
///      "type": "string",
///      "minLength": 1
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct CodeAgentError {
    pub code: CodeAgentErrorCode,
    #[serde(
        rename = "correlationId",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub correlation_id: ::std::option::Option<CodeAgentErrorCorrelationId>,
    pub message: CodeAgentErrorMessage,
}
///`CodeAgentErrorCode`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "string",
///      "const": "cancelled"
///    },
///    {
///      "type": "string",
///      "const": "capacity_exceeded"
///    },
///    {
///      "type": "string",
///      "const": "conflict"
///    },
///    {
///      "type": "string",
///      "const": "internal"
///    },
///    {
///      "type": "string",
///      "const": "invalid_input"
///    },
///    {
///      "type": "string",
///      "const": "not_found"
///    },
///    {
///      "type": "string",
///      "const": "provider_failure"
///    },
///    {
///      "type": "string",
///      "const": "shutting_down"
///    },
///    {
///      "type": "string",
///      "const": "timeout"
///    }
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum CodeAgentErrorCode {
    #[serde(rename = "cancelled")]
    Cancelled,
    #[serde(rename = "capacity_exceeded")]
    CapacityExceeded,
    #[serde(rename = "conflict")]
    Conflict,
    #[serde(rename = "internal")]
    Internal,
    #[serde(rename = "invalid_input")]
    InvalidInput,
    #[serde(rename = "not_found")]
    NotFound,
    #[serde(rename = "provider_failure")]
    ProviderFailure,
    #[serde(rename = "shutting_down")]
    ShuttingDown,
    #[serde(rename = "timeout")]
    Timeout,
}
impl ::std::fmt::Display for CodeAgentErrorCode {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Cancelled => f.write_str("cancelled"),
            Self::CapacityExceeded => f.write_str("capacity_exceeded"),
            Self::Conflict => f.write_str("conflict"),
            Self::Internal => f.write_str("internal"),
            Self::InvalidInput => f.write_str("invalid_input"),
            Self::NotFound => f.write_str("not_found"),
            Self::ProviderFailure => f.write_str("provider_failure"),
            Self::ShuttingDown => f.write_str("shutting_down"),
            Self::Timeout => f.write_str("timeout"),
        }
    }
}
impl ::std::str::FromStr for CodeAgentErrorCode {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "cancelled" => Ok(Self::Cancelled),
            "capacity_exceeded" => Ok(Self::CapacityExceeded),
            "conflict" => Ok(Self::Conflict),
            "internal" => Ok(Self::Internal),
            "invalid_input" => Ok(Self::InvalidInput),
            "not_found" => Ok(Self::NotFound),
            "provider_failure" => Ok(Self::ProviderFailure),
            "shutting_down" => Ok(Self::ShuttingDown),
            "timeout" => Ok(Self::Timeout),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for CodeAgentErrorCode {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for CodeAgentErrorCode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for CodeAgentErrorCode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`CodeAgentErrorCorrelationId`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct CodeAgentErrorCorrelationId(::std::string::String);
impl ::std::ops::Deref for CodeAgentErrorCorrelationId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<CodeAgentErrorCorrelationId> for ::std::string::String {
    fn from(value: CodeAgentErrorCorrelationId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for CodeAgentErrorCorrelationId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for CodeAgentErrorCorrelationId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for CodeAgentErrorCorrelationId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for CodeAgentErrorCorrelationId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for CodeAgentErrorCorrelationId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`CodeAgentErrorMessage`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct CodeAgentErrorMessage(::std::string::String);
impl ::std::ops::Deref for CodeAgentErrorMessage {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<CodeAgentErrorMessage> for ::std::string::String {
    fn from(value: CodeAgentErrorMessage) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for CodeAgentErrorMessage {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for CodeAgentErrorMessage {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for CodeAgentErrorMessage {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for CodeAgentErrorMessage {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for CodeAgentErrorMessage {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ProjectId`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ProjectId(::std::string::String);
impl ::std::ops::Deref for ProjectId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ProjectId> for ::std::string::String {
    fn from(value: ProjectId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ProjectId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ProjectId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ProjectId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ProjectId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ProjectId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`TaskId`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct TaskId(::std::string::String);
impl ::std::ops::Deref for TaskId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<TaskId> for ::std::string::String {
    fn from(value: TaskId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for TaskId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for TaskId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for TaskId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for TaskId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for TaskId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
