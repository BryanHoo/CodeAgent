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
///`AgentAttachment`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "id",
///    "kind",
///    "mediaType",
///    "name",
///    "size"
///  ],
///  "properties": {
///    "id": {
///      "type": "string",
///      "minLength": 1
///    },
///    "kind": {
///      "oneOf": [
///        {
///          "type": "string",
///          "const": "file"
///        },
///        {
///          "type": "string",
///          "const": "image"
///        },
///        {
///          "type": "string",
///          "const": "text"
///        }
///      ]
///    },
///    "mediaType": {
///      "type": "string",
///      "maxLength": 255,
///      "minLength": 1
///    },
///    "name": {
///      "type": "string",
///      "maxLength": 255,
///      "minLength": 1
///    },
///    "size": {
///      "type": "integer",
///      "maximum": 52428800.0,
///      "minimum": 1.0
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct AgentAttachment {
    pub id: AgentAttachmentId,
    pub kind: AgentAttachmentKind,
    #[serde(rename = "mediaType")]
    pub media_type: AgentAttachmentMediaType,
    pub name: AgentAttachmentName,
    pub size: ::std::num::NonZeroU64,
}
///`AgentAttachmentId`
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
pub struct AgentAttachmentId(::std::string::String);
impl ::std::ops::Deref for AgentAttachmentId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentAttachmentId> for ::std::string::String {
    fn from(value: AgentAttachmentId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentAttachmentId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentAttachmentId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentAttachmentId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentAttachmentId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentAttachmentId {
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
///`AgentAttachmentKind`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "string",
///      "const": "file"
///    },
///    {
///      "type": "string",
///      "const": "image"
///    },
///    {
///      "type": "string",
///      "const": "text"
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
pub enum AgentAttachmentKind {
    #[serde(rename = "file")]
    File,
    #[serde(rename = "image")]
    Image,
    #[serde(rename = "text")]
    Text,
}
impl ::std::fmt::Display for AgentAttachmentKind {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::File => f.write_str("file"),
            Self::Image => f.write_str("image"),
            Self::Text => f.write_str("text"),
        }
    }
}
impl ::std::str::FromStr for AgentAttachmentKind {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "file" => Ok(Self::File),
            "image" => Ok(Self::Image),
            "text" => Ok(Self::Text),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for AgentAttachmentKind {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentAttachmentKind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentAttachmentKind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`AgentAttachmentMediaType`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 255,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct AgentAttachmentMediaType(::std::string::String);
impl ::std::ops::Deref for AgentAttachmentMediaType {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentAttachmentMediaType> for ::std::string::String {
    fn from(value: AgentAttachmentMediaType) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentAttachmentMediaType {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 255usize {
            return Err("longer than 255 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentAttachmentMediaType {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentAttachmentMediaType {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentAttachmentMediaType {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentAttachmentMediaType {
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
///`AgentAttachmentName`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 255,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct AgentAttachmentName(::std::string::String);
impl ::std::ops::Deref for AgentAttachmentName {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentAttachmentName> for ::std::string::String {
    fn from(value: AgentAttachmentName) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentAttachmentName {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 255usize {
            return Err("longer than 255 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentAttachmentName {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentAttachmentName {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentAttachmentName {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentAttachmentName {
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
///`AgentGlobalSettings`
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
///        "commitMessageModel",
///        "commitMessagePrompt",
///        "commitMessageReasoningEffort",
///        "defaultOpenAppId",
///        "followUpBehavior",
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
///        "commitMessageModel": {
///          "type": "string",
///          "minLength": 1
///        },
///        "commitMessagePrompt": {
///          "type": "string",
///          "maxLength": 4000
///        },
///        "commitMessageReasoningEffort": {
///          "type": "string",
///          "minLength": 1
///        },
///        "defaultOpenAppId": {
///          "oneOf": [
///            {
///              "oneOf": [
///                {
///                  "type": "string",
///                  "const": "visual-studio-code"
///                },
///                {
///                  "type": "string",
///                  "const": "zed"
///                },
///                {
///                  "type": "string",
///                  "const": "windsurf"
///                },
///                {
///                  "type": "string",
///                  "const": "finder"
///                },
///                {
///                  "type": "string",
///                  "const": "terminal"
///                },
///                {
///                  "type": "string",
///                  "const": "ghostty"
///                },
///                {
///                  "type": "string",
///                  "const": "xcode"
///                },
///                {
///                  "type": "string",
///                  "const": "android-studio"
///                },
///                {
///                  "type": "string",
///                  "const": "file-manager"
///                },
///                {
///                  "type": "string",
///                  "const": "gnome-terminal"
///                },
///                {
///                  "type": "string",
///                  "const": "konsole"
///                },
///                {
///                  "type": "string",
///                  "const": "xfce-terminal"
///                },
///                {
///                  "type": "string",
///                  "const": "explorer"
///                },
///                {
///                  "type": "string",
///                  "const": "windows-terminal"
///                },
///                {
///                  "type": "string",
///                  "const": "command-prompt"
///                }
///              ]
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "followUpBehavior": {
///          "oneOf": [
///            {
///              "type": "string",
///              "const": "queue"
///            },
///            {
///              "type": "string",
///              "const": "steer"
///            }
///          ]
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
///        "commitMessageModel",
///        "commitMessagePrompt",
///        "commitMessageReasoningEffort",
///        "defaultOpenAppId",
///        "followUpBehavior",
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
///        "commitMessageModel": {
///          "type": "string",
///          "minLength": 1
///        },
///        "commitMessagePrompt": {
///          "type": "string",
///          "maxLength": 4000
///        },
///        "commitMessageReasoningEffort": {
///          "type": "string",
///          "minLength": 1
///        },
///        "defaultOpenAppId": {
///          "oneOf": [
///            {
///              "oneOf": [
///                {
///                  "type": "string",
///                  "const": "visual-studio-code"
///                },
///                {
///                  "type": "string",
///                  "const": "zed"
///                },
///                {
///                  "type": "string",
///                  "const": "windsurf"
///                },
///                {
///                  "type": "string",
///                  "const": "finder"
///                },
///                {
///                  "type": "string",
///                  "const": "terminal"
///                },
///                {
///                  "type": "string",
///                  "const": "ghostty"
///                },
///                {
///                  "type": "string",
///                  "const": "xcode"
///                },
///                {
///                  "type": "string",
///                  "const": "android-studio"
///                },
///                {
///                  "type": "string",
///                  "const": "file-manager"
///                },
///                {
///                  "type": "string",
///                  "const": "gnome-terminal"
///                },
///                {
///                  "type": "string",
///                  "const": "konsole"
///                },
///                {
///                  "type": "string",
///                  "const": "xfce-terminal"
///                },
///                {
///                  "type": "string",
///                  "const": "explorer"
///                },
///                {
///                  "type": "string",
///                  "const": "windows-terminal"
///                },
///                {
///                  "type": "string",
///                  "const": "command-prompt"
///                }
///              ]
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "followUpBehavior": {
///          "oneOf": [
///            {
///              "type": "string",
///              "const": "queue"
///            },
///            {
///              "type": "string",
///              "const": "steer"
///            }
///          ]
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
pub enum AgentGlobalSettings {
    #[serde(rename = "user")]
    User {
        #[serde(rename = "approvalPolicy")]
        approval_policy: AgentGlobalSettingsApprovalPolicy,
        #[serde(rename = "commitMessageModel")]
        commit_message_model: AgentGlobalSettingsCommitMessageModel,
        #[serde(rename = "commitMessagePrompt")]
        commit_message_prompt: AgentGlobalSettingsCommitMessagePrompt,
        #[serde(rename = "commitMessageReasoningEffort")]
        commit_message_reasoning_effort: AgentGlobalSettingsCommitMessageReasoningEffort,
        #[serde(rename = "defaultOpenAppId")]
        default_open_app_id: ::std::option::Option<AgentGlobalSettingsDefaultOpenAppId>,
        #[serde(rename = "followUpBehavior")]
        follow_up_behavior: AgentGlobalSettingsFollowUpBehavior,
        model: AgentGlobalSettingsModel,
        #[serde(rename = "reasoningEffort")]
        reasoning_effort: AgentGlobalSettingsReasoningEffort,
        #[serde(rename = "sandboxMode")]
        sandbox_mode: AgentGlobalSettingsSandboxMode,
    },
    #[serde(rename = "auto_review")]
    AutoReview {
        #[serde(rename = "approvalPolicy")]
        approval_policy: ::std::string::String,
        #[serde(rename = "commitMessageModel")]
        commit_message_model: AgentGlobalSettingsCommitMessageModel,
        #[serde(rename = "commitMessagePrompt")]
        commit_message_prompt: AgentGlobalSettingsCommitMessagePrompt,
        #[serde(rename = "commitMessageReasoningEffort")]
        commit_message_reasoning_effort: AgentGlobalSettingsCommitMessageReasoningEffort,
        #[serde(rename = "defaultOpenAppId")]
        default_open_app_id: ::std::option::Option<AgentGlobalSettingsDefaultOpenAppId>,
        #[serde(rename = "followUpBehavior")]
        follow_up_behavior: AgentGlobalSettingsFollowUpBehavior,
        model: AgentGlobalSettingsModel,
        #[serde(rename = "reasoningEffort")]
        reasoning_effort: AgentGlobalSettingsReasoningEffort,
        #[serde(rename = "sandboxMode")]
        sandbox_mode: AgentGlobalSettingsSandboxMode,
    },
}
///`AgentGlobalSettingsApprovalPolicy`
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
pub enum AgentGlobalSettingsApprovalPolicy {
    #[serde(rename = "untrusted")]
    Untrusted,
    #[serde(rename = "on-request")]
    OnRequest,
    #[serde(rename = "never")]
    Never,
}
impl ::std::fmt::Display for AgentGlobalSettingsApprovalPolicy {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Untrusted => f.write_str("untrusted"),
            Self::OnRequest => f.write_str("on-request"),
            Self::Never => f.write_str("never"),
        }
    }
}
impl ::std::str::FromStr for AgentGlobalSettingsApprovalPolicy {
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
impl ::std::convert::TryFrom<&str> for AgentGlobalSettingsApprovalPolicy {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentGlobalSettingsApprovalPolicy {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentGlobalSettingsApprovalPolicy {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`AgentGlobalSettingsCommitMessageModel`
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
pub struct AgentGlobalSettingsCommitMessageModel(::std::string::String);
impl ::std::ops::Deref for AgentGlobalSettingsCommitMessageModel {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentGlobalSettingsCommitMessageModel> for ::std::string::String {
    fn from(value: AgentGlobalSettingsCommitMessageModel) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentGlobalSettingsCommitMessageModel {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentGlobalSettingsCommitMessageModel {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentGlobalSettingsCommitMessageModel {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentGlobalSettingsCommitMessageModel {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentGlobalSettingsCommitMessageModel {
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
///`AgentGlobalSettingsCommitMessagePrompt`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 4000
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct AgentGlobalSettingsCommitMessagePrompt(::std::string::String);
impl ::std::ops::Deref for AgentGlobalSettingsCommitMessagePrompt {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentGlobalSettingsCommitMessagePrompt> for ::std::string::String {
    fn from(value: AgentGlobalSettingsCommitMessagePrompt) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentGlobalSettingsCommitMessagePrompt {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 4000usize {
            return Err("longer than 4000 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentGlobalSettingsCommitMessagePrompt {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentGlobalSettingsCommitMessagePrompt {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentGlobalSettingsCommitMessagePrompt {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentGlobalSettingsCommitMessagePrompt {
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
///`AgentGlobalSettingsCommitMessageReasoningEffort`
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
pub struct AgentGlobalSettingsCommitMessageReasoningEffort(::std::string::String);
impl ::std::ops::Deref for AgentGlobalSettingsCommitMessageReasoningEffort {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentGlobalSettingsCommitMessageReasoningEffort>
    for ::std::string::String
{
    fn from(value: AgentGlobalSettingsCommitMessageReasoningEffort) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentGlobalSettingsCommitMessageReasoningEffort {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentGlobalSettingsCommitMessageReasoningEffort {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for AgentGlobalSettingsCommitMessageReasoningEffort
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for AgentGlobalSettingsCommitMessageReasoningEffort
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentGlobalSettingsCommitMessageReasoningEffort {
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
///`AgentGlobalSettingsDefaultOpenAppId`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "string",
///      "const": "visual-studio-code"
///    },
///    {
///      "type": "string",
///      "const": "zed"
///    },
///    {
///      "type": "string",
///      "const": "windsurf"
///    },
///    {
///      "type": "string",
///      "const": "finder"
///    },
///    {
///      "type": "string",
///      "const": "terminal"
///    },
///    {
///      "type": "string",
///      "const": "ghostty"
///    },
///    {
///      "type": "string",
///      "const": "xcode"
///    },
///    {
///      "type": "string",
///      "const": "android-studio"
///    },
///    {
///      "type": "string",
///      "const": "file-manager"
///    },
///    {
///      "type": "string",
///      "const": "gnome-terminal"
///    },
///    {
///      "type": "string",
///      "const": "konsole"
///    },
///    {
///      "type": "string",
///      "const": "xfce-terminal"
///    },
///    {
///      "type": "string",
///      "const": "explorer"
///    },
///    {
///      "type": "string",
///      "const": "windows-terminal"
///    },
///    {
///      "type": "string",
///      "const": "command-prompt"
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
pub enum AgentGlobalSettingsDefaultOpenAppId {
    #[serde(rename = "visual-studio-code")]
    VisualStudioCode,
    #[serde(rename = "zed")]
    Zed,
    #[serde(rename = "windsurf")]
    Windsurf,
    #[serde(rename = "finder")]
    Finder,
    #[serde(rename = "terminal")]
    Terminal,
    #[serde(rename = "ghostty")]
    Ghostty,
    #[serde(rename = "xcode")]
    Xcode,
    #[serde(rename = "android-studio")]
    AndroidStudio,
    #[serde(rename = "file-manager")]
    FileManager,
    #[serde(rename = "gnome-terminal")]
    GnomeTerminal,
    #[serde(rename = "konsole")]
    Konsole,
    #[serde(rename = "xfce-terminal")]
    XfceTerminal,
    #[serde(rename = "explorer")]
    Explorer,
    #[serde(rename = "windows-terminal")]
    WindowsTerminal,
    #[serde(rename = "command-prompt")]
    CommandPrompt,
}
impl ::std::fmt::Display for AgentGlobalSettingsDefaultOpenAppId {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::VisualStudioCode => f.write_str("visual-studio-code"),
            Self::Zed => f.write_str("zed"),
            Self::Windsurf => f.write_str("windsurf"),
            Self::Finder => f.write_str("finder"),
            Self::Terminal => f.write_str("terminal"),
            Self::Ghostty => f.write_str("ghostty"),
            Self::Xcode => f.write_str("xcode"),
            Self::AndroidStudio => f.write_str("android-studio"),
            Self::FileManager => f.write_str("file-manager"),
            Self::GnomeTerminal => f.write_str("gnome-terminal"),
            Self::Konsole => f.write_str("konsole"),
            Self::XfceTerminal => f.write_str("xfce-terminal"),
            Self::Explorer => f.write_str("explorer"),
            Self::WindowsTerminal => f.write_str("windows-terminal"),
            Self::CommandPrompt => f.write_str("command-prompt"),
        }
    }
}
impl ::std::str::FromStr for AgentGlobalSettingsDefaultOpenAppId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "visual-studio-code" => Ok(Self::VisualStudioCode),
            "zed" => Ok(Self::Zed),
            "windsurf" => Ok(Self::Windsurf),
            "finder" => Ok(Self::Finder),
            "terminal" => Ok(Self::Terminal),
            "ghostty" => Ok(Self::Ghostty),
            "xcode" => Ok(Self::Xcode),
            "android-studio" => Ok(Self::AndroidStudio),
            "file-manager" => Ok(Self::FileManager),
            "gnome-terminal" => Ok(Self::GnomeTerminal),
            "konsole" => Ok(Self::Konsole),
            "xfce-terminal" => Ok(Self::XfceTerminal),
            "explorer" => Ok(Self::Explorer),
            "windows-terminal" => Ok(Self::WindowsTerminal),
            "command-prompt" => Ok(Self::CommandPrompt),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for AgentGlobalSettingsDefaultOpenAppId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentGlobalSettingsDefaultOpenAppId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentGlobalSettingsDefaultOpenAppId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`AgentGlobalSettingsFollowUpBehavior`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "string",
///      "const": "queue"
///    },
///    {
///      "type": "string",
///      "const": "steer"
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
pub enum AgentGlobalSettingsFollowUpBehavior {
    #[serde(rename = "queue")]
    Queue,
    #[serde(rename = "steer")]
    Steer,
}
impl ::std::fmt::Display for AgentGlobalSettingsFollowUpBehavior {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Queue => f.write_str("queue"),
            Self::Steer => f.write_str("steer"),
        }
    }
}
impl ::std::str::FromStr for AgentGlobalSettingsFollowUpBehavior {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "queue" => Ok(Self::Queue),
            "steer" => Ok(Self::Steer),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for AgentGlobalSettingsFollowUpBehavior {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentGlobalSettingsFollowUpBehavior {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentGlobalSettingsFollowUpBehavior {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`AgentGlobalSettingsModel`
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
pub struct AgentGlobalSettingsModel(::std::string::String);
impl ::std::ops::Deref for AgentGlobalSettingsModel {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentGlobalSettingsModel> for ::std::string::String {
    fn from(value: AgentGlobalSettingsModel) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentGlobalSettingsModel {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentGlobalSettingsModel {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentGlobalSettingsModel {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentGlobalSettingsModel {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentGlobalSettingsModel {
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
///`AgentGlobalSettingsReasoningEffort`
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
pub struct AgentGlobalSettingsReasoningEffort(::std::string::String);
impl ::std::ops::Deref for AgentGlobalSettingsReasoningEffort {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentGlobalSettingsReasoningEffort> for ::std::string::String {
    fn from(value: AgentGlobalSettingsReasoningEffort) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentGlobalSettingsReasoningEffort {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentGlobalSettingsReasoningEffort {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentGlobalSettingsReasoningEffort {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentGlobalSettingsReasoningEffort {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentGlobalSettingsReasoningEffort {
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
///`AgentGlobalSettingsSandboxMode`
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
pub enum AgentGlobalSettingsSandboxMode {
    #[serde(rename = "read-only")]
    ReadOnly,
    #[serde(rename = "workspace-write")]
    WorkspaceWrite,
    #[serde(rename = "danger-full-access")]
    DangerFullAccess,
}
impl ::std::fmt::Display for AgentGlobalSettingsSandboxMode {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::ReadOnly => f.write_str("read-only"),
            Self::WorkspaceWrite => f.write_str("workspace-write"),
            Self::DangerFullAccess => f.write_str("danger-full-access"),
        }
    }
}
impl ::std::str::FromStr for AgentGlobalSettingsSandboxMode {
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
impl ::std::convert::TryFrom<&str> for AgentGlobalSettingsSandboxMode {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentGlobalSettingsSandboxMode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentGlobalSettingsSandboxMode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`AgentProjectDefaults`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "model",
///    "reasoningEffort",
///    "sandboxMode"
///  ],
///  "properties": {
///    "model": {
///      "type": "string",
///      "minLength": 1
///    },
///    "reasoningEffort": {
///      "type": "string",
///      "minLength": 1
///    },
///    "sandboxMode": {
///      "oneOf": [
///        {
///          "type": "string",
///          "const": "read-only"
///        },
///        {
///          "type": "string",
///          "const": "workspace-write"
///        },
///        {
///          "type": "string",
///          "const": "danger-full-access"
///        }
///      ]
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct AgentProjectDefaults {
    pub model: AgentProjectDefaultsModel,
    #[serde(rename = "reasoningEffort")]
    pub reasoning_effort: AgentProjectDefaultsReasoningEffort,
    #[serde(rename = "sandboxMode")]
    pub sandbox_mode: AgentProjectDefaultsSandboxMode,
}
///`AgentProjectDefaultsModel`
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
pub struct AgentProjectDefaultsModel(::std::string::String);
impl ::std::ops::Deref for AgentProjectDefaultsModel {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentProjectDefaultsModel> for ::std::string::String {
    fn from(value: AgentProjectDefaultsModel) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentProjectDefaultsModel {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentProjectDefaultsModel {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentProjectDefaultsModel {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentProjectDefaultsModel {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentProjectDefaultsModel {
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
///`AgentProjectDefaultsReasoningEffort`
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
pub struct AgentProjectDefaultsReasoningEffort(::std::string::String);
impl ::std::ops::Deref for AgentProjectDefaultsReasoningEffort {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentProjectDefaultsReasoningEffort> for ::std::string::String {
    fn from(value: AgentProjectDefaultsReasoningEffort) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentProjectDefaultsReasoningEffort {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentProjectDefaultsReasoningEffort {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentProjectDefaultsReasoningEffort {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentProjectDefaultsReasoningEffort {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentProjectDefaultsReasoningEffort {
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
///`AgentProjectDefaultsSandboxMode`
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
pub enum AgentProjectDefaultsSandboxMode {
    #[serde(rename = "read-only")]
    ReadOnly,
    #[serde(rename = "workspace-write")]
    WorkspaceWrite,
    #[serde(rename = "danger-full-access")]
    DangerFullAccess,
}
impl ::std::fmt::Display for AgentProjectDefaultsSandboxMode {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::ReadOnly => f.write_str("read-only"),
            Self::WorkspaceWrite => f.write_str("workspace-write"),
            Self::DangerFullAccess => f.write_str("danger-full-access"),
        }
    }
}
impl ::std::str::FromStr for AgentProjectDefaultsSandboxMode {
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
impl ::std::convert::TryFrom<&str> for AgentProjectDefaultsSandboxMode {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentProjectDefaultsSandboxMode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentProjectDefaultsSandboxMode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`AgentProviderConnectionRecord`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "customBaseUrl",
///    "customModels",
///    "mode",
///    "updatedAt"
///  ],
///  "properties": {
///    "customBaseUrl": {
///      "oneOf": [
///        {
///          "type": "string",
///          "maxLength": 2048,
///          "minLength": 1
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "customModels": {
///      "oneOf": [
///        {
///          "type": "object",
///          "required": [
///            "data",
///            "nextCursor"
///          ],
///          "properties": {
///            "data": {
///              "type": "array",
///              "items": {
///                "type": "object",
///                "required": [
///                  "defaultReasoningEffort",
///                  "description",
///                  "displayName",
///                  "id",
///                  "isDefault",
///                  "supportedReasoningEfforts"
///                ],
///                "properties": {
///                  "defaultReasoningEffort": {
///                    "type": "string",
///                    "minLength": 1
///                  },
///                  "description": {
///                    "type": "string"
///                  },
///                  "displayName": {
///                    "type": "string",
///                    "minLength": 1
///                  },
///                  "id": {
///                    "type": "string",
///                    "minLength": 1
///                  },
///                  "isDefault": {
///                    "type": "boolean"
///                  },
///                  "supportedReasoningEfforts": {
///                    "type": "array",
///                    "items": {
///                      "type": "object",
///                      "required": [
///                        "description",
///                        "id"
///                      ],
///                      "properties": {
///                        "description": {
///                          "type": "string"
///                        },
///                        "id": {
///                          "type": "string",
///                          "minLength": 1
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    "minItems": 1
///                  }
///                },
///                "additionalProperties": false
///              }
///            },
///            "nextCursor": {
///              "oneOf": [
///                {
///                  "type": "string"
///                },
///                {
///                  "type": "null"
///                }
///              ]
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "mode": {
///      "oneOf": [
///        {
///          "type": "string",
///          "const": "official"
///        },
///        {
///          "type": "string",
///          "const": "custom"
///        }
///      ]
///    },
///    "updatedAt": {
///      "type": "string",
///      "format": "date-time"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct AgentProviderConnectionRecord {
    #[serde(rename = "customBaseUrl")]
    pub custom_base_url: ::std::option::Option<AgentProviderConnectionRecordCustomBaseUrl>,
    #[serde(rename = "customModels")]
    pub custom_models: ::std::option::Option<AgentProviderConnectionRecordCustomModels>,
    pub mode: AgentProviderConnectionRecordMode,
    #[serde(rename = "updatedAt")]
    pub updated_at: ::chrono::DateTime<::chrono::offset::Utc>,
}
///`AgentProviderConnectionRecordCustomBaseUrl`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 2048,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct AgentProviderConnectionRecordCustomBaseUrl(::std::string::String);
impl ::std::ops::Deref for AgentProviderConnectionRecordCustomBaseUrl {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentProviderConnectionRecordCustomBaseUrl> for ::std::string::String {
    fn from(value: AgentProviderConnectionRecordCustomBaseUrl) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentProviderConnectionRecordCustomBaseUrl {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 2048usize {
            return Err("longer than 2048 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentProviderConnectionRecordCustomBaseUrl {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for AgentProviderConnectionRecordCustomBaseUrl
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentProviderConnectionRecordCustomBaseUrl {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentProviderConnectionRecordCustomBaseUrl {
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
///`AgentProviderConnectionRecordCustomModels`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "data",
///    "nextCursor"
///  ],
///  "properties": {
///    "data": {
///      "type": "array",
///      "items": {
///        "type": "object",
///        "required": [
///          "defaultReasoningEffort",
///          "description",
///          "displayName",
///          "id",
///          "isDefault",
///          "supportedReasoningEfforts"
///        ],
///        "properties": {
///          "defaultReasoningEffort": {
///            "type": "string",
///            "minLength": 1
///          },
///          "description": {
///            "type": "string"
///          },
///          "displayName": {
///            "type": "string",
///            "minLength": 1
///          },
///          "id": {
///            "type": "string",
///            "minLength": 1
///          },
///          "isDefault": {
///            "type": "boolean"
///          },
///          "supportedReasoningEfforts": {
///            "type": "array",
///            "items": {
///              "type": "object",
///              "required": [
///                "description",
///                "id"
///              ],
///              "properties": {
///                "description": {
///                  "type": "string"
///                },
///                "id": {
///                  "type": "string",
///                  "minLength": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            "minItems": 1
///          }
///        },
///        "additionalProperties": false
///      }
///    },
///    "nextCursor": {
///      "oneOf": [
///        {
///          "type": "string"
///        },
///        {
///          "type": "null"
///        }
///      ]
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct AgentProviderConnectionRecordCustomModels {
    pub data: ::std::vec::Vec<AgentProviderConnectionRecordCustomModelsDataItem>,
    #[serde(rename = "nextCursor")]
    pub next_cursor: ::std::option::Option<::std::string::String>,
}
///`AgentProviderConnectionRecordCustomModelsDataItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "defaultReasoningEffort",
///    "description",
///    "displayName",
///    "id",
///    "isDefault",
///    "supportedReasoningEfforts"
///  ],
///  "properties": {
///    "defaultReasoningEffort": {
///      "type": "string",
///      "minLength": 1
///    },
///    "description": {
///      "type": "string"
///    },
///    "displayName": {
///      "type": "string",
///      "minLength": 1
///    },
///    "id": {
///      "type": "string",
///      "minLength": 1
///    },
///    "isDefault": {
///      "type": "boolean"
///    },
///    "supportedReasoningEfforts": {
///      "type": "array",
///      "items": {
///        "type": "object",
///        "required": [
///          "description",
///          "id"
///        ],
///        "properties": {
///          "description": {
///            "type": "string"
///          },
///          "id": {
///            "type": "string",
///            "minLength": 1
///          }
///        },
///        "additionalProperties": false
///      },
///      "minItems": 1
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct AgentProviderConnectionRecordCustomModelsDataItem {
    #[serde(rename = "defaultReasoningEffort")]
    pub default_reasoning_effort:
        AgentProviderConnectionRecordCustomModelsDataItemDefaultReasoningEffort,
    pub description: ::std::string::String,
    #[serde(rename = "displayName")]
    pub display_name: AgentProviderConnectionRecordCustomModelsDataItemDisplayName,
    pub id: AgentProviderConnectionRecordCustomModelsDataItemId,
    #[serde(rename = "isDefault")]
    pub is_default: bool,
    #[serde(rename = "supportedReasoningEfforts")]
    pub supported_reasoning_efforts: ::std::vec::Vec<
        AgentProviderConnectionRecordCustomModelsDataItemSupportedReasoningEffortsItem,
    >,
}
///`AgentProviderConnectionRecordCustomModelsDataItemDefaultReasoningEffort`
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
pub struct AgentProviderConnectionRecordCustomModelsDataItemDefaultReasoningEffort(
    ::std::string::String,
);
impl ::std::ops::Deref for AgentProviderConnectionRecordCustomModelsDataItemDefaultReasoningEffort {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentProviderConnectionRecordCustomModelsDataItemDefaultReasoningEffort>
    for ::std::string::String
{
    fn from(
        value: AgentProviderConnectionRecordCustomModelsDataItemDefaultReasoningEffort,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for AgentProviderConnectionRecordCustomModelsDataItemDefaultReasoningEffort
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for AgentProviderConnectionRecordCustomModelsDataItemDefaultReasoningEffort
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for AgentProviderConnectionRecordCustomModelsDataItemDefaultReasoningEffort
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for AgentProviderConnectionRecordCustomModelsDataItemDefaultReasoningEffort
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for AgentProviderConnectionRecordCustomModelsDataItemDefaultReasoningEffort
{
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
///`AgentProviderConnectionRecordCustomModelsDataItemDisplayName`
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
pub struct AgentProviderConnectionRecordCustomModelsDataItemDisplayName(::std::string::String);
impl ::std::ops::Deref for AgentProviderConnectionRecordCustomModelsDataItemDisplayName {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentProviderConnectionRecordCustomModelsDataItemDisplayName>
    for ::std::string::String
{
    fn from(value: AgentProviderConnectionRecordCustomModelsDataItemDisplayName) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentProviderConnectionRecordCustomModelsDataItemDisplayName {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for AgentProviderConnectionRecordCustomModelsDataItemDisplayName
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for AgentProviderConnectionRecordCustomModelsDataItemDisplayName
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for AgentProviderConnectionRecordCustomModelsDataItemDisplayName
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for AgentProviderConnectionRecordCustomModelsDataItemDisplayName
{
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
///`AgentProviderConnectionRecordCustomModelsDataItemId`
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
pub struct AgentProviderConnectionRecordCustomModelsDataItemId(::std::string::String);
impl ::std::ops::Deref for AgentProviderConnectionRecordCustomModelsDataItemId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentProviderConnectionRecordCustomModelsDataItemId>
    for ::std::string::String
{
    fn from(value: AgentProviderConnectionRecordCustomModelsDataItemId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentProviderConnectionRecordCustomModelsDataItemId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentProviderConnectionRecordCustomModelsDataItemId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for AgentProviderConnectionRecordCustomModelsDataItemId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for AgentProviderConnectionRecordCustomModelsDataItemId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentProviderConnectionRecordCustomModelsDataItemId {
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
///`AgentProviderConnectionRecordCustomModelsDataItemSupportedReasoningEffortsItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "description",
///    "id"
///  ],
///  "properties": {
///    "description": {
///      "type": "string"
///    },
///    "id": {
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
pub struct AgentProviderConnectionRecordCustomModelsDataItemSupportedReasoningEffortsItem {
    pub description: ::std::string::String,
    pub id: AgentProviderConnectionRecordCustomModelsDataItemSupportedReasoningEffortsItemId,
}
///`AgentProviderConnectionRecordCustomModelsDataItemSupportedReasoningEffortsItemId`
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
pub struct AgentProviderConnectionRecordCustomModelsDataItemSupportedReasoningEffortsItemId(
    ::std::string::String,
);
impl ::std::ops::Deref
    for AgentProviderConnectionRecordCustomModelsDataItemSupportedReasoningEffortsItemId
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl
    ::std::convert::From<
        AgentProviderConnectionRecordCustomModelsDataItemSupportedReasoningEffortsItemId,
    > for ::std::string::String
{
    fn from(
        value: AgentProviderConnectionRecordCustomModelsDataItemSupportedReasoningEffortsItemId,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for AgentProviderConnectionRecordCustomModelsDataItemSupportedReasoningEffortsItemId
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for AgentProviderConnectionRecordCustomModelsDataItemSupportedReasoningEffortsItemId
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for AgentProviderConnectionRecordCustomModelsDataItemSupportedReasoningEffortsItemId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for AgentProviderConnectionRecordCustomModelsDataItemSupportedReasoningEffortsItemId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for AgentProviderConnectionRecordCustomModelsDataItemSupportedReasoningEffortsItemId
{
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
///`AgentProviderConnectionRecordMode`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "string",
///      "const": "official"
///    },
///    {
///      "type": "string",
///      "const": "custom"
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
pub enum AgentProviderConnectionRecordMode {
    #[serde(rename = "official")]
    Official,
    #[serde(rename = "custom")]
    Custom,
}
impl ::std::fmt::Display for AgentProviderConnectionRecordMode {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Official => f.write_str("official"),
            Self::Custom => f.write_str("custom"),
        }
    }
}
impl ::std::str::FromStr for AgentProviderConnectionRecordMode {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "official" => Ok(Self::Official),
            "custom" => Ok(Self::Custom),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for AgentProviderConnectionRecordMode {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentProviderConnectionRecordMode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentProviderConnectionRecordMode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
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
///`Project`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "createdAt",
///    "id",
///    "name",
///    "rootPath"
///  ],
///  "properties": {
///    "createdAt": {
///      "type": "string",
///      "format": "date-time"
///    },
///    "id": {
///      "type": "string",
///      "minLength": 1
///    },
///    "name": {
///      "type": "string",
///      "minLength": 1
///    },
///    "rootPath": {
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
pub struct Project {
    #[serde(rename = "createdAt")]
    pub created_at: ::chrono::DateTime<::chrono::offset::Utc>,
    pub id: ProjectId,
    pub name: ProjectName,
    #[serde(rename = "rootPath")]
    pub root_path: ProjectRootPath,
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
///`ProjectName`
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
pub struct ProjectName(::std::string::String);
impl ::std::ops::Deref for ProjectName {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ProjectName> for ::std::string::String {
    fn from(value: ProjectName) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ProjectName {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ProjectName {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ProjectName {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ProjectName {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ProjectName {
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
///`ProjectRootPath`
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
pub struct ProjectRootPath(::std::string::String);
impl ::std::ops::Deref for ProjectRootPath {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ProjectRootPath> for ::std::string::String {
    fn from(value: ProjectRootPath) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ProjectRootPath {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ProjectRootPath {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ProjectRootPath {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ProjectRootPath {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ProjectRootPath {
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
