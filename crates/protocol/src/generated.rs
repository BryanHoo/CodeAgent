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
///`AgentBackgroundTerminalPage`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "data"
///  ],
///  "properties": {
///    "data": {
///      "type": "array",
///      "items": {
///        "type": "object",
///        "required": [
///          "command",
///          "cwd",
///          "id",
///          "itemId"
///        ],
///        "properties": {
///          "command": {
///            "type": "string",
///            "minLength": 1
///          },
///          "cwd": {
///            "type": "string",
///            "minLength": 1
///          },
///          "id": {
///            "type": "string",
///            "minLength": 1
///          },
///          "itemId": {
///            "type": "string",
///            "minLength": 1
///          }
///        },
///        "additionalProperties": false
///      }
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct AgentBackgroundTerminalPage {
    pub data: ::std::vec::Vec<AgentBackgroundTerminalPageDataItem>,
}
///`AgentBackgroundTerminalPageDataItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "command",
///    "cwd",
///    "id",
///    "itemId"
///  ],
///  "properties": {
///    "command": {
///      "type": "string",
///      "minLength": 1
///    },
///    "cwd": {
///      "type": "string",
///      "minLength": 1
///    },
///    "id": {
///      "type": "string",
///      "minLength": 1
///    },
///    "itemId": {
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
pub struct AgentBackgroundTerminalPageDataItem {
    pub command: AgentBackgroundTerminalPageDataItemCommand,
    pub cwd: AgentBackgroundTerminalPageDataItemCwd,
    pub id: AgentBackgroundTerminalPageDataItemId,
    #[serde(rename = "itemId")]
    pub item_id: AgentBackgroundTerminalPageDataItemItemId,
}
///`AgentBackgroundTerminalPageDataItemCommand`
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
pub struct AgentBackgroundTerminalPageDataItemCommand(::std::string::String);
impl ::std::ops::Deref for AgentBackgroundTerminalPageDataItemCommand {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentBackgroundTerminalPageDataItemCommand> for ::std::string::String {
    fn from(value: AgentBackgroundTerminalPageDataItemCommand) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentBackgroundTerminalPageDataItemCommand {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentBackgroundTerminalPageDataItemCommand {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for AgentBackgroundTerminalPageDataItemCommand
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentBackgroundTerminalPageDataItemCommand {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentBackgroundTerminalPageDataItemCommand {
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
///`AgentBackgroundTerminalPageDataItemCwd`
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
pub struct AgentBackgroundTerminalPageDataItemCwd(::std::string::String);
impl ::std::ops::Deref for AgentBackgroundTerminalPageDataItemCwd {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentBackgroundTerminalPageDataItemCwd> for ::std::string::String {
    fn from(value: AgentBackgroundTerminalPageDataItemCwd) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentBackgroundTerminalPageDataItemCwd {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentBackgroundTerminalPageDataItemCwd {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentBackgroundTerminalPageDataItemCwd {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentBackgroundTerminalPageDataItemCwd {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentBackgroundTerminalPageDataItemCwd {
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
///`AgentBackgroundTerminalPageDataItemId`
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
pub struct AgentBackgroundTerminalPageDataItemId(::std::string::String);
impl ::std::ops::Deref for AgentBackgroundTerminalPageDataItemId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentBackgroundTerminalPageDataItemId> for ::std::string::String {
    fn from(value: AgentBackgroundTerminalPageDataItemId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentBackgroundTerminalPageDataItemId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentBackgroundTerminalPageDataItemId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentBackgroundTerminalPageDataItemId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentBackgroundTerminalPageDataItemId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentBackgroundTerminalPageDataItemId {
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
///`AgentBackgroundTerminalPageDataItemItemId`
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
pub struct AgentBackgroundTerminalPageDataItemItemId(::std::string::String);
impl ::std::ops::Deref for AgentBackgroundTerminalPageDataItemItemId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentBackgroundTerminalPageDataItemItemId> for ::std::string::String {
    fn from(value: AgentBackgroundTerminalPageDataItemItemId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentBackgroundTerminalPageDataItemItemId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentBackgroundTerminalPageDataItemItemId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentBackgroundTerminalPageDataItemItemId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentBackgroundTerminalPageDataItemItemId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentBackgroundTerminalPageDataItemItemId {
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
///`AgentMcpServerPage`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "data"
///  ],
///  "properties": {
///    "data": {
///      "type": "array",
///      "items": {
///        "type": "object",
///        "required": [
///          "authStatus",
///          "description",
///          "error",
///          "failureReason",
///          "name",
///          "status",
///          "title",
///          "toolCount",
///          "version"
///        ],
///        "properties": {
///          "authStatus": {
///            "oneOf": [
///              {
///                "oneOf": [
///                  {
///                    "type": "string",
///                    "const": "unknown"
///                  },
///                  {
///                    "type": "string",
///                    "const": "unsupported"
///                  },
///                  {
///                    "type": "string",
///                    "const": "notLoggedIn"
///                  },
///                  {
///                    "type": "string",
///                    "const": "bearerToken"
///                  },
///                  {
///                    "type": "string",
///                    "const": "oAuth"
///                  }
///                ]
///              },
///              {
///                "type": "null"
///              }
///            ]
///          },
///          "description": {
///            "oneOf": [
///              {
///                "type": "string"
///              },
///              {
///                "type": "null"
///              }
///            ]
///          },
///          "error": {
///            "oneOf": [
///              {
///                "type": "string"
///              },
///              {
///                "type": "null"
///              }
///            ]
///          },
///          "failureReason": {
///            "oneOf": [
///              {
///                "type": "string",
///                "const": "reauthenticationRequired"
///              },
///              {
///                "type": "null"
///              }
///            ]
///          },
///          "name": {
///            "type": "string",
///            "minLength": 1
///          },
///          "status": {
///            "oneOf": [
///              {
///                "type": "string",
///                "const": "starting"
///              },
///              {
///                "type": "string",
///                "const": "ready"
///              },
///              {
///                "type": "string",
///                "const": "failed"
///              },
///              {
///                "type": "string",
///                "const": "cancelled"
///              }
///            ]
///          },
///          "title": {
///            "oneOf": [
///              {
///                "type": "string"
///              },
///              {
///                "type": "null"
///              }
///            ]
///          },
///          "toolCount": {
///            "type": "integer",
///            "minimum": 0.0
///          },
///          "version": {
///            "oneOf": [
///              {
///                "type": "string"
///              },
///              {
///                "type": "null"
///              }
///            ]
///          }
///        },
///        "additionalProperties": false
///      },
///      "uniqueItems": true
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct AgentMcpServerPage {
    pub data: Vec<AgentMcpServerPageDataItem>,
}
///`AgentMcpServerPageDataItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "authStatus",
///    "description",
///    "error",
///    "failureReason",
///    "name",
///    "status",
///    "title",
///    "toolCount",
///    "version"
///  ],
///  "properties": {
///    "authStatus": {
///      "oneOf": [
///        {
///          "oneOf": [
///            {
///              "type": "string",
///              "const": "unknown"
///            },
///            {
///              "type": "string",
///              "const": "unsupported"
///            },
///            {
///              "type": "string",
///              "const": "notLoggedIn"
///            },
///            {
///              "type": "string",
///              "const": "bearerToken"
///            },
///            {
///              "type": "string",
///              "const": "oAuth"
///            }
///          ]
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "description": {
///      "oneOf": [
///        {
///          "type": "string"
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "error": {
///      "oneOf": [
///        {
///          "type": "string"
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "failureReason": {
///      "oneOf": [
///        {
///          "type": "string",
///          "const": "reauthenticationRequired"
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "name": {
///      "type": "string",
///      "minLength": 1
///    },
///    "status": {
///      "oneOf": [
///        {
///          "type": "string",
///          "const": "starting"
///        },
///        {
///          "type": "string",
///          "const": "ready"
///        },
///        {
///          "type": "string",
///          "const": "failed"
///        },
///        {
///          "type": "string",
///          "const": "cancelled"
///        }
///      ]
///    },
///    "title": {
///      "oneOf": [
///        {
///          "type": "string"
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "toolCount": {
///      "type": "integer",
///      "minimum": 0.0
///    },
///    "version": {
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
pub struct AgentMcpServerPageDataItem {
    #[serde(rename = "authStatus")]
    pub auth_status: ::std::option::Option<AgentMcpServerPageDataItemAuthStatus>,
    pub description: ::std::option::Option<::std::string::String>,
    pub error: ::std::option::Option<::std::string::String>,
    #[serde(rename = "failureReason")]
    pub failure_reason: ::std::option::Option<::std::string::String>,
    pub name: AgentMcpServerPageDataItemName,
    pub status: AgentMcpServerPageDataItemStatus,
    pub title: ::std::option::Option<::std::string::String>,
    #[serde(rename = "toolCount")]
    pub tool_count: u64,
    pub version: ::std::option::Option<::std::string::String>,
}
///`AgentMcpServerPageDataItemAuthStatus`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "string",
///      "const": "unknown"
///    },
///    {
///      "type": "string",
///      "const": "unsupported"
///    },
///    {
///      "type": "string",
///      "const": "notLoggedIn"
///    },
///    {
///      "type": "string",
///      "const": "bearerToken"
///    },
///    {
///      "type": "string",
///      "const": "oAuth"
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
pub enum AgentMcpServerPageDataItemAuthStatus {
    #[serde(rename = "unknown")]
    Unknown,
    #[serde(rename = "unsupported")]
    Unsupported,
    #[serde(rename = "notLoggedIn")]
    NotLoggedIn,
    #[serde(rename = "bearerToken")]
    BearerToken,
    #[serde(rename = "oAuth")]
    OAuth,
}
impl ::std::fmt::Display for AgentMcpServerPageDataItemAuthStatus {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Unknown => f.write_str("unknown"),
            Self::Unsupported => f.write_str("unsupported"),
            Self::NotLoggedIn => f.write_str("notLoggedIn"),
            Self::BearerToken => f.write_str("bearerToken"),
            Self::OAuth => f.write_str("oAuth"),
        }
    }
}
impl ::std::str::FromStr for AgentMcpServerPageDataItemAuthStatus {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "unknown" => Ok(Self::Unknown),
            "unsupported" => Ok(Self::Unsupported),
            "notLoggedIn" => Ok(Self::NotLoggedIn),
            "bearerToken" => Ok(Self::BearerToken),
            "oAuth" => Ok(Self::OAuth),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for AgentMcpServerPageDataItemAuthStatus {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentMcpServerPageDataItemAuthStatus {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentMcpServerPageDataItemAuthStatus {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`AgentMcpServerPageDataItemName`
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
pub struct AgentMcpServerPageDataItemName(::std::string::String);
impl ::std::ops::Deref for AgentMcpServerPageDataItemName {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentMcpServerPageDataItemName> for ::std::string::String {
    fn from(value: AgentMcpServerPageDataItemName) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentMcpServerPageDataItemName {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentMcpServerPageDataItemName {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentMcpServerPageDataItemName {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentMcpServerPageDataItemName {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentMcpServerPageDataItemName {
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
///`AgentMcpServerPageDataItemStatus`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "string",
///      "const": "starting"
///    },
///    {
///      "type": "string",
///      "const": "ready"
///    },
///    {
///      "type": "string",
///      "const": "failed"
///    },
///    {
///      "type": "string",
///      "const": "cancelled"
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
pub enum AgentMcpServerPageDataItemStatus {
    #[serde(rename = "starting")]
    Starting,
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "failed")]
    Failed,
    #[serde(rename = "cancelled")]
    Cancelled,
}
impl ::std::fmt::Display for AgentMcpServerPageDataItemStatus {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Starting => f.write_str("starting"),
            Self::Ready => f.write_str("ready"),
            Self::Failed => f.write_str("failed"),
            Self::Cancelled => f.write_str("cancelled"),
        }
    }
}
impl ::std::str::FromStr for AgentMcpServerPageDataItemStatus {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "starting" => Ok(Self::Starting),
            "ready" => Ok(Self::Ready),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for AgentMcpServerPageDataItemStatus {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentMcpServerPageDataItemStatus {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentMcpServerPageDataItemStatus {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`AgentModelPage`
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
pub struct AgentModelPage {
    pub data: ::std::vec::Vec<AgentModelPageDataItem>,
    #[serde(rename = "nextCursor")]
    pub next_cursor: ::std::option::Option<::std::string::String>,
}
///`AgentModelPageDataItem`
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
pub struct AgentModelPageDataItem {
    #[serde(rename = "defaultReasoningEffort")]
    pub default_reasoning_effort: AgentModelPageDataItemDefaultReasoningEffort,
    pub description: ::std::string::String,
    #[serde(rename = "displayName")]
    pub display_name: AgentModelPageDataItemDisplayName,
    pub id: AgentModelPageDataItemId,
    #[serde(rename = "isDefault")]
    pub is_default: bool,
    #[serde(rename = "supportedReasoningEfforts")]
    pub supported_reasoning_efforts:
        ::std::vec::Vec<AgentModelPageDataItemSupportedReasoningEffortsItem>,
}
///`AgentModelPageDataItemDefaultReasoningEffort`
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
pub struct AgentModelPageDataItemDefaultReasoningEffort(::std::string::String);
impl ::std::ops::Deref for AgentModelPageDataItemDefaultReasoningEffort {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentModelPageDataItemDefaultReasoningEffort> for ::std::string::String {
    fn from(value: AgentModelPageDataItemDefaultReasoningEffort) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentModelPageDataItemDefaultReasoningEffort {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentModelPageDataItemDefaultReasoningEffort {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for AgentModelPageDataItemDefaultReasoningEffort
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for AgentModelPageDataItemDefaultReasoningEffort
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentModelPageDataItemDefaultReasoningEffort {
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
///`AgentModelPageDataItemDisplayName`
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
pub struct AgentModelPageDataItemDisplayName(::std::string::String);
impl ::std::ops::Deref for AgentModelPageDataItemDisplayName {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentModelPageDataItemDisplayName> for ::std::string::String {
    fn from(value: AgentModelPageDataItemDisplayName) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentModelPageDataItemDisplayName {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentModelPageDataItemDisplayName {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentModelPageDataItemDisplayName {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentModelPageDataItemDisplayName {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentModelPageDataItemDisplayName {
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
///`AgentModelPageDataItemId`
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
pub struct AgentModelPageDataItemId(::std::string::String);
impl ::std::ops::Deref for AgentModelPageDataItemId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentModelPageDataItemId> for ::std::string::String {
    fn from(value: AgentModelPageDataItemId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentModelPageDataItemId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentModelPageDataItemId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentModelPageDataItemId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentModelPageDataItemId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentModelPageDataItemId {
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
///`AgentModelPageDataItemSupportedReasoningEffortsItem`
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
pub struct AgentModelPageDataItemSupportedReasoningEffortsItem {
    pub description: ::std::string::String,
    pub id: AgentModelPageDataItemSupportedReasoningEffortsItemId,
}
///`AgentModelPageDataItemSupportedReasoningEffortsItemId`
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
pub struct AgentModelPageDataItemSupportedReasoningEffortsItemId(::std::string::String);
impl ::std::ops::Deref for AgentModelPageDataItemSupportedReasoningEffortsItemId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentModelPageDataItemSupportedReasoningEffortsItemId>
    for ::std::string::String
{
    fn from(value: AgentModelPageDataItemSupportedReasoningEffortsItemId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentModelPageDataItemSupportedReasoningEffortsItemId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentModelPageDataItemSupportedReasoningEffortsItemId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for AgentModelPageDataItemSupportedReasoningEffortsItemId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for AgentModelPageDataItemSupportedReasoningEffortsItemId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentModelPageDataItemSupportedReasoningEffortsItemId {
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
///`AgentProviderConnectionMutationResponse`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "status"
///  ],
///  "properties": {
///    "status": {
///      "type": "object",
///      "required": [
///        "account",
///        "customBaseUrl",
///        "mode",
///        "pendingLogin",
///        "state"
///      ],
///      "properties": {
///        "account": {
///          "oneOf": [
///            {
///              "oneOf": [
///                {
///                  "type": "object",
///                  "required": [
///                    "email",
///                    "planType",
///                    "type"
///                  ],
///                  "properties": {
///                    "email": {
///                      "oneOf": [
///                        {
///                          "type": "string",
///                          "maxLength": 320
///                        },
///                        {
///                          "type": "null"
///                        }
///                      ]
///                    },
///                    "planType": {
///                      "oneOf": [
///                        {
///                          "type": "string",
///                          "maxLength": 64
///                        },
///                        {
///                          "type": "null"
///                        }
///                      ]
///                    },
///                    "type": {
///                      "type": "string",
///                      "const": "chatgpt"
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "type"
///                  ],
///                  "properties": {
///                    "type": {
///                      "type": "string",
///                      "const": "apiKey"
///                    }
///                  },
///                  "additionalProperties": false
///                }
///              ]
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "customBaseUrl": {
///          "oneOf": [
///            {
///              "type": "string",
///              "maxLength": 2048,
///              "minLength": 1
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "mode": {
///          "oneOf": [
///            {
///              "type": "string",
///              "const": "official"
///            },
///            {
///              "type": "string",
///              "const": "custom"
///            }
///          ]
///        },
///        "pendingLogin": {
///          "oneOf": [
///            {
///              "type": "object",
///              "required": [
///                "error",
///                "loginId",
///                "state"
///              ],
///              "properties": {
///                "error": {
///                  "oneOf": [
///                    {
///                      "type": "string"
///                    },
///                    {
///                      "type": "null"
///                    }
///                  ]
///                },
///                "loginId": {
///                  "type": "string",
///                  "maxLength": 256,
///                  "minLength": 1
///                },
///                "state": {
///                  "oneOf": [
///                    {
///                      "type": "string",
///                      "const": "pending"
///                    },
///                    {
///                      "type": "string",
///                      "const": "failed"
///                    }
///                  ]
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "state": {
///          "oneOf": [
///            {
///              "type": "string",
///              "const": "disconnected"
///            },
///            {
///              "type": "string",
///              "const": "pending"
///            },
///            {
///              "type": "string",
///              "const": "connected"
///            },
///            {
///              "type": "string",
///              "const": "failed"
///            }
///          ]
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
pub struct AgentProviderConnectionMutationResponse {
    pub status: AgentProviderConnectionMutationResponseStatus,
}
///`AgentProviderConnectionMutationResponseStatus`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "account",
///    "customBaseUrl",
///    "mode",
///    "pendingLogin",
///    "state"
///  ],
///  "properties": {
///    "account": {
///      "oneOf": [
///        {
///          "oneOf": [
///            {
///              "type": "object",
///              "required": [
///                "email",
///                "planType",
///                "type"
///              ],
///              "properties": {
///                "email": {
///                  "oneOf": [
///                    {
///                      "type": "string",
///                      "maxLength": 320
///                    },
///                    {
///                      "type": "null"
///                    }
///                  ]
///                },
///                "planType": {
///                  "oneOf": [
///                    {
///                      "type": "string",
///                      "maxLength": 64
///                    },
///                    {
///                      "type": "null"
///                    }
///                  ]
///                },
///                "type": {
///                  "type": "string",
///                  "const": "chatgpt"
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "type"
///              ],
///              "properties": {
///                "type": {
///                  "type": "string",
///                  "const": "apiKey"
///                }
///              },
///              "additionalProperties": false
///            }
///          ]
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
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
///    "pendingLogin": {
///      "oneOf": [
///        {
///          "type": "object",
///          "required": [
///            "error",
///            "loginId",
///            "state"
///          ],
///          "properties": {
///            "error": {
///              "oneOf": [
///                {
///                  "type": "string"
///                },
///                {
///                  "type": "null"
///                }
///              ]
///            },
///            "loginId": {
///              "type": "string",
///              "maxLength": 256,
///              "minLength": 1
///            },
///            "state": {
///              "oneOf": [
///                {
///                  "type": "string",
///                  "const": "pending"
///                },
///                {
///                  "type": "string",
///                  "const": "failed"
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
///    "state": {
///      "oneOf": [
///        {
///          "type": "string",
///          "const": "disconnected"
///        },
///        {
///          "type": "string",
///          "const": "pending"
///        },
///        {
///          "type": "string",
///          "const": "connected"
///        },
///        {
///          "type": "string",
///          "const": "failed"
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
pub struct AgentProviderConnectionMutationResponseStatus {
    pub account: ::std::option::Option<AgentProviderConnectionMutationResponseStatusAccount>,
    #[serde(rename = "customBaseUrl")]
    pub custom_base_url:
        ::std::option::Option<AgentProviderConnectionMutationResponseStatusCustomBaseUrl>,
    pub mode: AgentProviderConnectionMutationResponseStatusMode,
    #[serde(rename = "pendingLogin")]
    pub pending_login:
        ::std::option::Option<AgentProviderConnectionMutationResponseStatusPendingLogin>,
    pub state: AgentProviderConnectionMutationResponseStatusState,
}
///`AgentProviderConnectionMutationResponseStatusAccount`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "object",
///      "required": [
///        "email",
///        "planType",
///        "type"
///      ],
///      "properties": {
///        "email": {
///          "oneOf": [
///            {
///              "type": "string",
///              "maxLength": 320
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "planType": {
///          "oneOf": [
///            {
///              "type": "string",
///              "maxLength": 64
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "type": {
///          "type": "string",
///          "const": "chatgpt"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "type"
///      ],
///      "properties": {
///        "type": {
///          "type": "string",
///          "const": "apiKey"
///        }
///      },
///      "additionalProperties": false
///    }
///  ]
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum AgentProviderConnectionMutationResponseStatusAccount {
    #[serde(rename = "chatgpt")]
    Chatgpt {
        email: ::std::option::Option<AgentProviderConnectionMutationResponseStatusAccountEmail>,
        #[serde(rename = "planType")]
        plan_type:
            ::std::option::Option<AgentProviderConnectionMutationResponseStatusAccountPlanType>,
    },
    #[serde(rename = "apiKey")]
    ApiKey,
}
///`AgentProviderConnectionMutationResponseStatusAccountEmail`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 320
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct AgentProviderConnectionMutationResponseStatusAccountEmail(::std::string::String);
impl ::std::ops::Deref for AgentProviderConnectionMutationResponseStatusAccountEmail {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentProviderConnectionMutationResponseStatusAccountEmail>
    for ::std::string::String
{
    fn from(value: AgentProviderConnectionMutationResponseStatusAccountEmail) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentProviderConnectionMutationResponseStatusAccountEmail {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 320usize {
            return Err("longer than 320 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentProviderConnectionMutationResponseStatusAccountEmail {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for AgentProviderConnectionMutationResponseStatusAccountEmail
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for AgentProviderConnectionMutationResponseStatusAccountEmail
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentProviderConnectionMutationResponseStatusAccountEmail {
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
///`AgentProviderConnectionMutationResponseStatusAccountPlanType`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 64
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct AgentProviderConnectionMutationResponseStatusAccountPlanType(::std::string::String);
impl ::std::ops::Deref for AgentProviderConnectionMutationResponseStatusAccountPlanType {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentProviderConnectionMutationResponseStatusAccountPlanType>
    for ::std::string::String
{
    fn from(value: AgentProviderConnectionMutationResponseStatusAccountPlanType) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentProviderConnectionMutationResponseStatusAccountPlanType {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 64usize {
            return Err("longer than 64 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for AgentProviderConnectionMutationResponseStatusAccountPlanType
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for AgentProviderConnectionMutationResponseStatusAccountPlanType
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for AgentProviderConnectionMutationResponseStatusAccountPlanType
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for AgentProviderConnectionMutationResponseStatusAccountPlanType
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
///`AgentProviderConnectionMutationResponseStatusCustomBaseUrl`
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
pub struct AgentProviderConnectionMutationResponseStatusCustomBaseUrl(::std::string::String);
impl ::std::ops::Deref for AgentProviderConnectionMutationResponseStatusCustomBaseUrl {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentProviderConnectionMutationResponseStatusCustomBaseUrl>
    for ::std::string::String
{
    fn from(value: AgentProviderConnectionMutationResponseStatusCustomBaseUrl) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentProviderConnectionMutationResponseStatusCustomBaseUrl {
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
impl ::std::convert::TryFrom<&str> for AgentProviderConnectionMutationResponseStatusCustomBaseUrl {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for AgentProviderConnectionMutationResponseStatusCustomBaseUrl
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for AgentProviderConnectionMutationResponseStatusCustomBaseUrl
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentProviderConnectionMutationResponseStatusCustomBaseUrl {
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
///`AgentProviderConnectionMutationResponseStatusMode`
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
pub enum AgentProviderConnectionMutationResponseStatusMode {
    #[serde(rename = "official")]
    Official,
    #[serde(rename = "custom")]
    Custom,
}
impl ::std::fmt::Display for AgentProviderConnectionMutationResponseStatusMode {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Official => f.write_str("official"),
            Self::Custom => f.write_str("custom"),
        }
    }
}
impl ::std::str::FromStr for AgentProviderConnectionMutationResponseStatusMode {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "official" => Ok(Self::Official),
            "custom" => Ok(Self::Custom),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for AgentProviderConnectionMutationResponseStatusMode {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for AgentProviderConnectionMutationResponseStatusMode
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for AgentProviderConnectionMutationResponseStatusMode
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`AgentProviderConnectionMutationResponseStatusPendingLogin`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "error",
///    "loginId",
///    "state"
///  ],
///  "properties": {
///    "error": {
///      "oneOf": [
///        {
///          "type": "string"
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "loginId": {
///      "type": "string",
///      "maxLength": 256,
///      "minLength": 1
///    },
///    "state": {
///      "oneOf": [
///        {
///          "type": "string",
///          "const": "pending"
///        },
///        {
///          "type": "string",
///          "const": "failed"
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
pub struct AgentProviderConnectionMutationResponseStatusPendingLogin {
    pub error: ::std::option::Option<::std::string::String>,
    #[serde(rename = "loginId")]
    pub login_id: AgentProviderConnectionMutationResponseStatusPendingLoginLoginId,
    pub state: AgentProviderConnectionMutationResponseStatusPendingLoginState,
}
///`AgentProviderConnectionMutationResponseStatusPendingLoginLoginId`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 256,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct AgentProviderConnectionMutationResponseStatusPendingLoginLoginId(::std::string::String);
impl ::std::ops::Deref for AgentProviderConnectionMutationResponseStatusPendingLoginLoginId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentProviderConnectionMutationResponseStatusPendingLoginLoginId>
    for ::std::string::String
{
    fn from(value: AgentProviderConnectionMutationResponseStatusPendingLoginLoginId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentProviderConnectionMutationResponseStatusPendingLoginLoginId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 256usize {
            return Err("longer than 256 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for AgentProviderConnectionMutationResponseStatusPendingLoginLoginId
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for AgentProviderConnectionMutationResponseStatusPendingLoginLoginId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for AgentProviderConnectionMutationResponseStatusPendingLoginLoginId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for AgentProviderConnectionMutationResponseStatusPendingLoginLoginId
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
///`AgentProviderConnectionMutationResponseStatusPendingLoginState`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "string",
///      "const": "pending"
///    },
///    {
///      "type": "string",
///      "const": "failed"
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
pub enum AgentProviderConnectionMutationResponseStatusPendingLoginState {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "failed")]
    Failed,
}
impl ::std::fmt::Display for AgentProviderConnectionMutationResponseStatusPendingLoginState {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Pending => f.write_str("pending"),
            Self::Failed => f.write_str("failed"),
        }
    }
}
impl ::std::str::FromStr for AgentProviderConnectionMutationResponseStatusPendingLoginState {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "pending" => Ok(Self::Pending),
            "failed" => Ok(Self::Failed),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str>
    for AgentProviderConnectionMutationResponseStatusPendingLoginState
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for AgentProviderConnectionMutationResponseStatusPendingLoginState
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for AgentProviderConnectionMutationResponseStatusPendingLoginState
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`AgentProviderConnectionMutationResponseStatusState`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "string",
///      "const": "disconnected"
///    },
///    {
///      "type": "string",
///      "const": "pending"
///    },
///    {
///      "type": "string",
///      "const": "connected"
///    },
///    {
///      "type": "string",
///      "const": "failed"
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
pub enum AgentProviderConnectionMutationResponseStatusState {
    #[serde(rename = "disconnected")]
    Disconnected,
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "connected")]
    Connected,
    #[serde(rename = "failed")]
    Failed,
}
impl ::std::fmt::Display for AgentProviderConnectionMutationResponseStatusState {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Disconnected => f.write_str("disconnected"),
            Self::Pending => f.write_str("pending"),
            Self::Connected => f.write_str("connected"),
            Self::Failed => f.write_str("failed"),
        }
    }
}
impl ::std::str::FromStr for AgentProviderConnectionMutationResponseStatusState {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "disconnected" => Ok(Self::Disconnected),
            "pending" => Ok(Self::Pending),
            "connected" => Ok(Self::Connected),
            "failed" => Ok(Self::Failed),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for AgentProviderConnectionMutationResponseStatusState {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for AgentProviderConnectionMutationResponseStatusState
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for AgentProviderConnectionMutationResponseStatusState
{
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
///`AgentProviderConnectionStatus`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "account",
///    "customBaseUrl",
///    "mode",
///    "pendingLogin",
///    "state"
///  ],
///  "properties": {
///    "account": {
///      "oneOf": [
///        {
///          "oneOf": [
///            {
///              "type": "object",
///              "required": [
///                "email",
///                "planType",
///                "type"
///              ],
///              "properties": {
///                "email": {
///                  "oneOf": [
///                    {
///                      "type": "string",
///                      "maxLength": 320
///                    },
///                    {
///                      "type": "null"
///                    }
///                  ]
///                },
///                "planType": {
///                  "oneOf": [
///                    {
///                      "type": "string",
///                      "maxLength": 64
///                    },
///                    {
///                      "type": "null"
///                    }
///                  ]
///                },
///                "type": {
///                  "type": "string",
///                  "const": "chatgpt"
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "type"
///              ],
///              "properties": {
///                "type": {
///                  "type": "string",
///                  "const": "apiKey"
///                }
///              },
///              "additionalProperties": false
///            }
///          ]
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
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
///    "pendingLogin": {
///      "oneOf": [
///        {
///          "type": "object",
///          "required": [
///            "error",
///            "loginId",
///            "state"
///          ],
///          "properties": {
///            "error": {
///              "oneOf": [
///                {
///                  "type": "string"
///                },
///                {
///                  "type": "null"
///                }
///              ]
///            },
///            "loginId": {
///              "type": "string",
///              "maxLength": 256,
///              "minLength": 1
///            },
///            "state": {
///              "oneOf": [
///                {
///                  "type": "string",
///                  "const": "pending"
///                },
///                {
///                  "type": "string",
///                  "const": "failed"
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
///    "state": {
///      "oneOf": [
///        {
///          "type": "string",
///          "const": "disconnected"
///        },
///        {
///          "type": "string",
///          "const": "pending"
///        },
///        {
///          "type": "string",
///          "const": "connected"
///        },
///        {
///          "type": "string",
///          "const": "failed"
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
pub struct AgentProviderConnectionStatus {
    pub account: ::std::option::Option<AgentProviderConnectionStatusAccount>,
    #[serde(rename = "customBaseUrl")]
    pub custom_base_url: ::std::option::Option<AgentProviderConnectionStatusCustomBaseUrl>,
    pub mode: AgentProviderConnectionStatusMode,
    #[serde(rename = "pendingLogin")]
    pub pending_login: ::std::option::Option<AgentProviderConnectionStatusPendingLogin>,
    pub state: AgentProviderConnectionStatusState,
}
///`AgentProviderConnectionStatusAccount`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "object",
///      "required": [
///        "email",
///        "planType",
///        "type"
///      ],
///      "properties": {
///        "email": {
///          "oneOf": [
///            {
///              "type": "string",
///              "maxLength": 320
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "planType": {
///          "oneOf": [
///            {
///              "type": "string",
///              "maxLength": 64
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "type": {
///          "type": "string",
///          "const": "chatgpt"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "type"
///      ],
///      "properties": {
///        "type": {
///          "type": "string",
///          "const": "apiKey"
///        }
///      },
///      "additionalProperties": false
///    }
///  ]
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum AgentProviderConnectionStatusAccount {
    #[serde(rename = "chatgpt")]
    Chatgpt {
        email: ::std::option::Option<AgentProviderConnectionStatusAccountEmail>,
        #[serde(rename = "planType")]
        plan_type: ::std::option::Option<AgentProviderConnectionStatusAccountPlanType>,
    },
    #[serde(rename = "apiKey")]
    ApiKey,
}
///`AgentProviderConnectionStatusAccountEmail`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 320
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct AgentProviderConnectionStatusAccountEmail(::std::string::String);
impl ::std::ops::Deref for AgentProviderConnectionStatusAccountEmail {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentProviderConnectionStatusAccountEmail> for ::std::string::String {
    fn from(value: AgentProviderConnectionStatusAccountEmail) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentProviderConnectionStatusAccountEmail {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 320usize {
            return Err("longer than 320 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentProviderConnectionStatusAccountEmail {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentProviderConnectionStatusAccountEmail {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentProviderConnectionStatusAccountEmail {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentProviderConnectionStatusAccountEmail {
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
///`AgentProviderConnectionStatusAccountPlanType`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 64
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct AgentProviderConnectionStatusAccountPlanType(::std::string::String);
impl ::std::ops::Deref for AgentProviderConnectionStatusAccountPlanType {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentProviderConnectionStatusAccountPlanType> for ::std::string::String {
    fn from(value: AgentProviderConnectionStatusAccountPlanType) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentProviderConnectionStatusAccountPlanType {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 64usize {
            return Err("longer than 64 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentProviderConnectionStatusAccountPlanType {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for AgentProviderConnectionStatusAccountPlanType
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for AgentProviderConnectionStatusAccountPlanType
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentProviderConnectionStatusAccountPlanType {
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
///`AgentProviderConnectionStatusCustomBaseUrl`
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
pub struct AgentProviderConnectionStatusCustomBaseUrl(::std::string::String);
impl ::std::ops::Deref for AgentProviderConnectionStatusCustomBaseUrl {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentProviderConnectionStatusCustomBaseUrl> for ::std::string::String {
    fn from(value: AgentProviderConnectionStatusCustomBaseUrl) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentProviderConnectionStatusCustomBaseUrl {
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
impl ::std::convert::TryFrom<&str> for AgentProviderConnectionStatusCustomBaseUrl {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for AgentProviderConnectionStatusCustomBaseUrl
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentProviderConnectionStatusCustomBaseUrl {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentProviderConnectionStatusCustomBaseUrl {
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
///`AgentProviderConnectionStatusMode`
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
pub enum AgentProviderConnectionStatusMode {
    #[serde(rename = "official")]
    Official,
    #[serde(rename = "custom")]
    Custom,
}
impl ::std::fmt::Display for AgentProviderConnectionStatusMode {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Official => f.write_str("official"),
            Self::Custom => f.write_str("custom"),
        }
    }
}
impl ::std::str::FromStr for AgentProviderConnectionStatusMode {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "official" => Ok(Self::Official),
            "custom" => Ok(Self::Custom),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for AgentProviderConnectionStatusMode {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentProviderConnectionStatusMode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentProviderConnectionStatusMode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`AgentProviderConnectionStatusPendingLogin`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "error",
///    "loginId",
///    "state"
///  ],
///  "properties": {
///    "error": {
///      "oneOf": [
///        {
///          "type": "string"
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "loginId": {
///      "type": "string",
///      "maxLength": 256,
///      "minLength": 1
///    },
///    "state": {
///      "oneOf": [
///        {
///          "type": "string",
///          "const": "pending"
///        },
///        {
///          "type": "string",
///          "const": "failed"
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
pub struct AgentProviderConnectionStatusPendingLogin {
    pub error: ::std::option::Option<::std::string::String>,
    #[serde(rename = "loginId")]
    pub login_id: AgentProviderConnectionStatusPendingLoginLoginId,
    pub state: AgentProviderConnectionStatusPendingLoginState,
}
///`AgentProviderConnectionStatusPendingLoginLoginId`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 256,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct AgentProviderConnectionStatusPendingLoginLoginId(::std::string::String);
impl ::std::ops::Deref for AgentProviderConnectionStatusPendingLoginLoginId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentProviderConnectionStatusPendingLoginLoginId>
    for ::std::string::String
{
    fn from(value: AgentProviderConnectionStatusPendingLoginLoginId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentProviderConnectionStatusPendingLoginLoginId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 256usize {
            return Err("longer than 256 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentProviderConnectionStatusPendingLoginLoginId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for AgentProviderConnectionStatusPendingLoginLoginId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for AgentProviderConnectionStatusPendingLoginLoginId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentProviderConnectionStatusPendingLoginLoginId {
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
///`AgentProviderConnectionStatusPendingLoginState`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "string",
///      "const": "pending"
///    },
///    {
///      "type": "string",
///      "const": "failed"
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
pub enum AgentProviderConnectionStatusPendingLoginState {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "failed")]
    Failed,
}
impl ::std::fmt::Display for AgentProviderConnectionStatusPendingLoginState {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Pending => f.write_str("pending"),
            Self::Failed => f.write_str("failed"),
        }
    }
}
impl ::std::str::FromStr for AgentProviderConnectionStatusPendingLoginState {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "pending" => Ok(Self::Pending),
            "failed" => Ok(Self::Failed),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for AgentProviderConnectionStatusPendingLoginState {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for AgentProviderConnectionStatusPendingLoginState
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for AgentProviderConnectionStatusPendingLoginState
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`AgentProviderConnectionStatusState`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "string",
///      "const": "disconnected"
///    },
///    {
///      "type": "string",
///      "const": "pending"
///    },
///    {
///      "type": "string",
///      "const": "connected"
///    },
///    {
///      "type": "string",
///      "const": "failed"
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
pub enum AgentProviderConnectionStatusState {
    #[serde(rename = "disconnected")]
    Disconnected,
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "connected")]
    Connected,
    #[serde(rename = "failed")]
    Failed,
}
impl ::std::fmt::Display for AgentProviderConnectionStatusState {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Disconnected => f.write_str("disconnected"),
            Self::Pending => f.write_str("pending"),
            Self::Connected => f.write_str("connected"),
            Self::Failed => f.write_str("failed"),
        }
    }
}
impl ::std::str::FromStr for AgentProviderConnectionStatusState {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "disconnected" => Ok(Self::Disconnected),
            "pending" => Ok(Self::Pending),
            "connected" => Ok(Self::Connected),
            "failed" => Ok(Self::Failed),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for AgentProviderConnectionStatusState {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentProviderConnectionStatusState {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentProviderConnectionStatusState {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`AgentSkillPage`
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
///          "description",
///          "displayName",
///          "id",
///          "name",
///          "scope"
///        ],
///        "properties": {
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
///          "name": {
///            "type": "string",
///            "minLength": 1
///          },
///          "scope": {
///            "oneOf": [
///              {
///                "type": "string",
///                "const": "user"
///              },
///              {
///                "type": "string",
///                "const": "repo"
///              },
///              {
///                "type": "string",
///                "const": "system"
///              },
///              {
///                "type": "string",
///                "const": "admin"
///              }
///            ]
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
pub struct AgentSkillPage {
    pub data: ::std::vec::Vec<AgentSkillPageDataItem>,
    #[serde(rename = "nextCursor")]
    pub next_cursor: ::std::option::Option<::std::string::String>,
}
///`AgentSkillPageDataItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "description",
///    "displayName",
///    "id",
///    "name",
///    "scope"
///  ],
///  "properties": {
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
///    "name": {
///      "type": "string",
///      "minLength": 1
///    },
///    "scope": {
///      "oneOf": [
///        {
///          "type": "string",
///          "const": "user"
///        },
///        {
///          "type": "string",
///          "const": "repo"
///        },
///        {
///          "type": "string",
///          "const": "system"
///        },
///        {
///          "type": "string",
///          "const": "admin"
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
pub struct AgentSkillPageDataItem {
    pub description: ::std::string::String,
    #[serde(rename = "displayName")]
    pub display_name: AgentSkillPageDataItemDisplayName,
    pub id: AgentSkillPageDataItemId,
    pub name: AgentSkillPageDataItemName,
    pub scope: AgentSkillPageDataItemScope,
}
///`AgentSkillPageDataItemDisplayName`
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
pub struct AgentSkillPageDataItemDisplayName(::std::string::String);
impl ::std::ops::Deref for AgentSkillPageDataItemDisplayName {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentSkillPageDataItemDisplayName> for ::std::string::String {
    fn from(value: AgentSkillPageDataItemDisplayName) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentSkillPageDataItemDisplayName {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentSkillPageDataItemDisplayName {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentSkillPageDataItemDisplayName {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentSkillPageDataItemDisplayName {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentSkillPageDataItemDisplayName {
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
///`AgentSkillPageDataItemId`
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
pub struct AgentSkillPageDataItemId(::std::string::String);
impl ::std::ops::Deref for AgentSkillPageDataItemId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentSkillPageDataItemId> for ::std::string::String {
    fn from(value: AgentSkillPageDataItemId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentSkillPageDataItemId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentSkillPageDataItemId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentSkillPageDataItemId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentSkillPageDataItemId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentSkillPageDataItemId {
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
///`AgentSkillPageDataItemName`
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
pub struct AgentSkillPageDataItemName(::std::string::String);
impl ::std::ops::Deref for AgentSkillPageDataItemName {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentSkillPageDataItemName> for ::std::string::String {
    fn from(value: AgentSkillPageDataItemName) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentSkillPageDataItemName {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentSkillPageDataItemName {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentSkillPageDataItemName {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentSkillPageDataItemName {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentSkillPageDataItemName {
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
///`AgentSkillPageDataItemScope`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "string",
///      "const": "user"
///    },
///    {
///      "type": "string",
///      "const": "repo"
///    },
///    {
///      "type": "string",
///      "const": "system"
///    },
///    {
///      "type": "string",
///      "const": "admin"
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
pub enum AgentSkillPageDataItemScope {
    #[serde(rename = "user")]
    User,
    #[serde(rename = "repo")]
    Repo,
    #[serde(rename = "system")]
    System,
    #[serde(rename = "admin")]
    Admin,
}
impl ::std::fmt::Display for AgentSkillPageDataItemScope {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::User => f.write_str("user"),
            Self::Repo => f.write_str("repo"),
            Self::System => f.write_str("system"),
            Self::Admin => f.write_str("admin"),
        }
    }
}
impl ::std::str::FromStr for AgentSkillPageDataItemScope {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "user" => Ok(Self::User),
            "repo" => Ok(Self::Repo),
            "system" => Ok(Self::System),
            "admin" => Ok(Self::Admin),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for AgentSkillPageDataItemScope {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentSkillPageDataItemScope {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentSkillPageDataItemScope {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`AgentTask`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "id",
///    "pinned",
///    "projectId",
///    "title",
///    "updatedAt"
///  ],
///  "properties": {
///    "id": {
///      "type": "string",
///      "minLength": 1
///    },
///    "pinned": {
///      "type": "boolean"
///    },
///    "projectId": {
///      "type": "string",
///      "minLength": 1
///    },
///    "title": {
///      "type": "string",
///      "minLength": 1
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
pub struct AgentTask {
    pub id: AgentTaskId,
    pub pinned: bool,
    #[serde(rename = "projectId")]
    pub project_id: AgentTaskProjectId,
    pub title: AgentTaskTitle,
    #[serde(rename = "updatedAt")]
    pub updated_at: ::chrono::DateTime<::chrono::offset::Utc>,
}
///`AgentTaskId`
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
pub struct AgentTaskId(::std::string::String);
impl ::std::ops::Deref for AgentTaskId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentTaskId> for ::std::string::String {
    fn from(value: AgentTaskId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentTaskId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentTaskId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentTaskId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentTaskId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentTaskId {
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
///`AgentTaskPage`
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
///          "id",
///          "pinned",
///          "projectId",
///          "title",
///          "updatedAt"
///        ],
///        "properties": {
///          "id": {
///            "type": "string",
///            "minLength": 1
///          },
///          "pinned": {
///            "type": "boolean"
///          },
///          "projectId": {
///            "type": "string",
///            "minLength": 1
///          },
///          "title": {
///            "type": "string",
///            "minLength": 1
///          },
///          "updatedAt": {
///            "type": "string",
///            "format": "date-time"
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
pub struct AgentTaskPage {
    pub data: ::std::vec::Vec<AgentTaskPageDataItem>,
    #[serde(rename = "nextCursor")]
    pub next_cursor: ::std::option::Option<::std::string::String>,
}
///`AgentTaskPageDataItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "id",
///    "pinned",
///    "projectId",
///    "title",
///    "updatedAt"
///  ],
///  "properties": {
///    "id": {
///      "type": "string",
///      "minLength": 1
///    },
///    "pinned": {
///      "type": "boolean"
///    },
///    "projectId": {
///      "type": "string",
///      "minLength": 1
///    },
///    "title": {
///      "type": "string",
///      "minLength": 1
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
pub struct AgentTaskPageDataItem {
    pub id: AgentTaskPageDataItemId,
    pub pinned: bool,
    #[serde(rename = "projectId")]
    pub project_id: AgentTaskPageDataItemProjectId,
    pub title: AgentTaskPageDataItemTitle,
    #[serde(rename = "updatedAt")]
    pub updated_at: ::chrono::DateTime<::chrono::offset::Utc>,
}
///`AgentTaskPageDataItemId`
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
pub struct AgentTaskPageDataItemId(::std::string::String);
impl ::std::ops::Deref for AgentTaskPageDataItemId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentTaskPageDataItemId> for ::std::string::String {
    fn from(value: AgentTaskPageDataItemId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentTaskPageDataItemId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentTaskPageDataItemId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentTaskPageDataItemId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentTaskPageDataItemId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentTaskPageDataItemId {
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
///`AgentTaskPageDataItemProjectId`
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
pub struct AgentTaskPageDataItemProjectId(::std::string::String);
impl ::std::ops::Deref for AgentTaskPageDataItemProjectId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentTaskPageDataItemProjectId> for ::std::string::String {
    fn from(value: AgentTaskPageDataItemProjectId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentTaskPageDataItemProjectId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentTaskPageDataItemProjectId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentTaskPageDataItemProjectId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentTaskPageDataItemProjectId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentTaskPageDataItemProjectId {
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
///`AgentTaskPageDataItemTitle`
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
pub struct AgentTaskPageDataItemTitle(::std::string::String);
impl ::std::ops::Deref for AgentTaskPageDataItemTitle {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentTaskPageDataItemTitle> for ::std::string::String {
    fn from(value: AgentTaskPageDataItemTitle) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentTaskPageDataItemTitle {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentTaskPageDataItemTitle {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentTaskPageDataItemTitle {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentTaskPageDataItemTitle {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentTaskPageDataItemTitle {
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
///`AgentTaskProjectId`
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
pub struct AgentTaskProjectId(::std::string::String);
impl ::std::ops::Deref for AgentTaskProjectId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentTaskProjectId> for ::std::string::String {
    fn from(value: AgentTaskProjectId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentTaskProjectId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentTaskProjectId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentTaskProjectId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentTaskProjectId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentTaskProjectId {
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
///`AgentTaskTitle`
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
pub struct AgentTaskTitle(::std::string::String);
impl ::std::ops::Deref for AgentTaskTitle {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<AgentTaskTitle> for ::std::string::String {
    fn from(value: AgentTaskTitle) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for AgentTaskTitle {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for AgentTaskTitle {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AgentTaskTitle {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AgentTaskTitle {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for AgentTaskTitle {
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
///`CancelProviderLoginRequest`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "loginId"
///  ],
///  "properties": {
///    "loginId": {
///      "type": "string",
///      "maxLength": 256,
///      "minLength": 1
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct CancelProviderLoginRequest {
    #[serde(rename = "loginId")]
    pub login_id: CancelProviderLoginRequestLoginId,
}
///`CancelProviderLoginRequestLoginId`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 256,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct CancelProviderLoginRequestLoginId(::std::string::String);
impl ::std::ops::Deref for CancelProviderLoginRequestLoginId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<CancelProviderLoginRequestLoginId> for ::std::string::String {
    fn from(value: CancelProviderLoginRequestLoginId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for CancelProviderLoginRequestLoginId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 256usize {
            return Err("longer than 256 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for CancelProviderLoginRequestLoginId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for CancelProviderLoginRequestLoginId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for CancelProviderLoginRequestLoginId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for CancelProviderLoginRequestLoginId {
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
///    },
///    "mutationCode": {
///      "oneOf": [
///        {
///          "type": "string",
///          "const": "ACCESS_DENIED"
///        },
///        {
///          "type": "string",
///          "const": "IDEMPOTENCY_KEY_REQUIRED"
///        },
///        {
///          "type": "string",
///          "const": "IDEMPOTENCY_CONFLICT"
///        },
///        {
///          "type": "string",
///          "const": "IDEMPOTENCY_CAPACITY_EXCEEDED"
///        },
///        {
///          "type": "string",
///          "const": "INVALID_REQUEST"
///        },
///        {
///          "type": "string",
///          "const": "PROJECT_NOT_FOUND"
///        },
///        {
///          "type": "string",
///          "const": "TASK_NOT_FOUND"
///        },
///        {
///          "type": "string",
///          "const": "TURN_NOT_FOUND"
///        },
///        {
///          "type": "string",
///          "const": "TURN_NOT_RUNNING"
///        },
///        {
///          "type": "string",
///          "const": "ATTACHMENT_NOT_FOUND"
///        },
///        {
///          "type": "string",
///          "const": "PENDING_REQUEST_NOT_FOUND"
///        },
///        {
///          "type": "string",
///          "const": "PENDING_REQUEST_EXPIRED"
///        },
///        {
///          "type": "string",
///          "const": "PENDING_REQUEST_ALREADY_RESOLVED"
///        },
///        {
///          "type": "string",
///          "const": "PENDING_REQUEST_MISMATCH"
///        },
///        {
///          "type": "string",
///          "const": "PAIRING_FAILED"
///        },
///        {
///          "type": "string",
///          "const": "PAIRING_RATE_LIMITED"
///        },
///        {
///          "type": "string",
///          "const": "GIT_STATUS_CHANGED"
///        },
///        {
///          "type": "string",
///          "const": "GIT_REPOSITORY_UNAVAILABLE"
///        },
///        {
///          "type": "string",
///          "const": "GIT_PATH_UNAVAILABLE"
///        },
///        {
///          "type": "string",
///          "const": "GIT_COMMIT_FAILED"
///        },
///        {
///          "type": "string",
///          "const": "GIT_BRANCH_ALREADY_ACTIVE"
///        },
///        {
///          "type": "string",
///          "const": "GIT_BRANCH_ALREADY_EXISTS"
///        },
///        {
///          "type": "string",
///          "const": "GIT_BRANCH_CREATE_FAILED"
///        },
///        {
///          "type": "string",
///          "const": "GIT_BRANCH_INVALID"
///        },
///        {
///          "type": "string",
///          "const": "GIT_BRANCH_NOT_FOUND"
///        },
///        {
///          "type": "string",
///          "const": "GIT_BRANCH_SWITCH_FAILED"
///        },
///        {
///          "type": "string",
///          "const": "GIT_MUTATION_IN_PROGRESS"
///        },
///        {
///          "type": "string",
///          "const": "GIT_REPOSITORY_READ_ONLY"
///        },
///        {
///          "type": "string",
///          "const": "COMMIT_MESSAGE_GENERATION_FAILED"
///        },
///        {
///          "type": "string",
///          "const": "UPDATE_NOT_AVAILABLE"
///        },
///        {
///          "type": "string",
///          "const": "UPDATE_CHECK_FAILED"
///        },
///        {
///          "type": "string",
///          "const": "UPDATE_INSTALL_FAILED"
///        },
///        {
///          "type": "string",
///          "const": "PROVIDER_ERROR"
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
pub struct CodeAgentError {
    pub code: CodeAgentErrorCode,
    #[serde(
        rename = "correlationId",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub correlation_id: ::std::option::Option<CodeAgentErrorCorrelationId>,
    pub message: CodeAgentErrorMessage,
    #[serde(
        rename = "mutationCode",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub mutation_code: ::std::option::Option<CodeAgentErrorMutationCode>,
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
///`CodeAgentErrorMutationCode`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "string",
///      "const": "ACCESS_DENIED"
///    },
///    {
///      "type": "string",
///      "const": "IDEMPOTENCY_KEY_REQUIRED"
///    },
///    {
///      "type": "string",
///      "const": "IDEMPOTENCY_CONFLICT"
///    },
///    {
///      "type": "string",
///      "const": "IDEMPOTENCY_CAPACITY_EXCEEDED"
///    },
///    {
///      "type": "string",
///      "const": "INVALID_REQUEST"
///    },
///    {
///      "type": "string",
///      "const": "PROJECT_NOT_FOUND"
///    },
///    {
///      "type": "string",
///      "const": "TASK_NOT_FOUND"
///    },
///    {
///      "type": "string",
///      "const": "TURN_NOT_FOUND"
///    },
///    {
///      "type": "string",
///      "const": "TURN_NOT_RUNNING"
///    },
///    {
///      "type": "string",
///      "const": "ATTACHMENT_NOT_FOUND"
///    },
///    {
///      "type": "string",
///      "const": "PENDING_REQUEST_NOT_FOUND"
///    },
///    {
///      "type": "string",
///      "const": "PENDING_REQUEST_EXPIRED"
///    },
///    {
///      "type": "string",
///      "const": "PENDING_REQUEST_ALREADY_RESOLVED"
///    },
///    {
///      "type": "string",
///      "const": "PENDING_REQUEST_MISMATCH"
///    },
///    {
///      "type": "string",
///      "const": "PAIRING_FAILED"
///    },
///    {
///      "type": "string",
///      "const": "PAIRING_RATE_LIMITED"
///    },
///    {
///      "type": "string",
///      "const": "GIT_STATUS_CHANGED"
///    },
///    {
///      "type": "string",
///      "const": "GIT_REPOSITORY_UNAVAILABLE"
///    },
///    {
///      "type": "string",
///      "const": "GIT_PATH_UNAVAILABLE"
///    },
///    {
///      "type": "string",
///      "const": "GIT_COMMIT_FAILED"
///    },
///    {
///      "type": "string",
///      "const": "GIT_BRANCH_ALREADY_ACTIVE"
///    },
///    {
///      "type": "string",
///      "const": "GIT_BRANCH_ALREADY_EXISTS"
///    },
///    {
///      "type": "string",
///      "const": "GIT_BRANCH_CREATE_FAILED"
///    },
///    {
///      "type": "string",
///      "const": "GIT_BRANCH_INVALID"
///    },
///    {
///      "type": "string",
///      "const": "GIT_BRANCH_NOT_FOUND"
///    },
///    {
///      "type": "string",
///      "const": "GIT_BRANCH_SWITCH_FAILED"
///    },
///    {
///      "type": "string",
///      "const": "GIT_MUTATION_IN_PROGRESS"
///    },
///    {
///      "type": "string",
///      "const": "GIT_REPOSITORY_READ_ONLY"
///    },
///    {
///      "type": "string",
///      "const": "COMMIT_MESSAGE_GENERATION_FAILED"
///    },
///    {
///      "type": "string",
///      "const": "UPDATE_NOT_AVAILABLE"
///    },
///    {
///      "type": "string",
///      "const": "UPDATE_CHECK_FAILED"
///    },
///    {
///      "type": "string",
///      "const": "UPDATE_INSTALL_FAILED"
///    },
///    {
///      "type": "string",
///      "const": "PROVIDER_ERROR"
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
pub enum CodeAgentErrorMutationCode {
    #[serde(rename = "ACCESS_DENIED")]
    AccessDenied,
    #[serde(rename = "IDEMPOTENCY_KEY_REQUIRED")]
    IdempotencyKeyRequired,
    #[serde(rename = "IDEMPOTENCY_CONFLICT")]
    IdempotencyConflict,
    #[serde(rename = "IDEMPOTENCY_CAPACITY_EXCEEDED")]
    IdempotencyCapacityExceeded,
    #[serde(rename = "INVALID_REQUEST")]
    InvalidRequest,
    #[serde(rename = "PROJECT_NOT_FOUND")]
    ProjectNotFound,
    #[serde(rename = "TASK_NOT_FOUND")]
    TaskNotFound,
    #[serde(rename = "TURN_NOT_FOUND")]
    TurnNotFound,
    #[serde(rename = "TURN_NOT_RUNNING")]
    TurnNotRunning,
    #[serde(rename = "ATTACHMENT_NOT_FOUND")]
    AttachmentNotFound,
    #[serde(rename = "PENDING_REQUEST_NOT_FOUND")]
    PendingRequestNotFound,
    #[serde(rename = "PENDING_REQUEST_EXPIRED")]
    PendingRequestExpired,
    #[serde(rename = "PENDING_REQUEST_ALREADY_RESOLVED")]
    PendingRequestAlreadyResolved,
    #[serde(rename = "PENDING_REQUEST_MISMATCH")]
    PendingRequestMismatch,
    #[serde(rename = "PAIRING_FAILED")]
    PairingFailed,
    #[serde(rename = "PAIRING_RATE_LIMITED")]
    PairingRateLimited,
    #[serde(rename = "GIT_STATUS_CHANGED")]
    GitStatusChanged,
    #[serde(rename = "GIT_REPOSITORY_UNAVAILABLE")]
    GitRepositoryUnavailable,
    #[serde(rename = "GIT_PATH_UNAVAILABLE")]
    GitPathUnavailable,
    #[serde(rename = "GIT_COMMIT_FAILED")]
    GitCommitFailed,
    #[serde(rename = "GIT_BRANCH_ALREADY_ACTIVE")]
    GitBranchAlreadyActive,
    #[serde(rename = "GIT_BRANCH_ALREADY_EXISTS")]
    GitBranchAlreadyExists,
    #[serde(rename = "GIT_BRANCH_CREATE_FAILED")]
    GitBranchCreateFailed,
    #[serde(rename = "GIT_BRANCH_INVALID")]
    GitBranchInvalid,
    #[serde(rename = "GIT_BRANCH_NOT_FOUND")]
    GitBranchNotFound,
    #[serde(rename = "GIT_BRANCH_SWITCH_FAILED")]
    GitBranchSwitchFailed,
    #[serde(rename = "GIT_MUTATION_IN_PROGRESS")]
    GitMutationInProgress,
    #[serde(rename = "GIT_REPOSITORY_READ_ONLY")]
    GitRepositoryReadOnly,
    #[serde(rename = "COMMIT_MESSAGE_GENERATION_FAILED")]
    CommitMessageGenerationFailed,
    #[serde(rename = "UPDATE_NOT_AVAILABLE")]
    UpdateNotAvailable,
    #[serde(rename = "UPDATE_CHECK_FAILED")]
    UpdateCheckFailed,
    #[serde(rename = "UPDATE_INSTALL_FAILED")]
    UpdateInstallFailed,
    #[serde(rename = "PROVIDER_ERROR")]
    ProviderError,
}
impl ::std::fmt::Display for CodeAgentErrorMutationCode {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::AccessDenied => f.write_str("ACCESS_DENIED"),
            Self::IdempotencyKeyRequired => f.write_str("IDEMPOTENCY_KEY_REQUIRED"),
            Self::IdempotencyConflict => f.write_str("IDEMPOTENCY_CONFLICT"),
            Self::IdempotencyCapacityExceeded => f.write_str("IDEMPOTENCY_CAPACITY_EXCEEDED"),
            Self::InvalidRequest => f.write_str("INVALID_REQUEST"),
            Self::ProjectNotFound => f.write_str("PROJECT_NOT_FOUND"),
            Self::TaskNotFound => f.write_str("TASK_NOT_FOUND"),
            Self::TurnNotFound => f.write_str("TURN_NOT_FOUND"),
            Self::TurnNotRunning => f.write_str("TURN_NOT_RUNNING"),
            Self::AttachmentNotFound => f.write_str("ATTACHMENT_NOT_FOUND"),
            Self::PendingRequestNotFound => f.write_str("PENDING_REQUEST_NOT_FOUND"),
            Self::PendingRequestExpired => f.write_str("PENDING_REQUEST_EXPIRED"),
            Self::PendingRequestAlreadyResolved => f.write_str("PENDING_REQUEST_ALREADY_RESOLVED"),
            Self::PendingRequestMismatch => f.write_str("PENDING_REQUEST_MISMATCH"),
            Self::PairingFailed => f.write_str("PAIRING_FAILED"),
            Self::PairingRateLimited => f.write_str("PAIRING_RATE_LIMITED"),
            Self::GitStatusChanged => f.write_str("GIT_STATUS_CHANGED"),
            Self::GitRepositoryUnavailable => f.write_str("GIT_REPOSITORY_UNAVAILABLE"),
            Self::GitPathUnavailable => f.write_str("GIT_PATH_UNAVAILABLE"),
            Self::GitCommitFailed => f.write_str("GIT_COMMIT_FAILED"),
            Self::GitBranchAlreadyActive => f.write_str("GIT_BRANCH_ALREADY_ACTIVE"),
            Self::GitBranchAlreadyExists => f.write_str("GIT_BRANCH_ALREADY_EXISTS"),
            Self::GitBranchCreateFailed => f.write_str("GIT_BRANCH_CREATE_FAILED"),
            Self::GitBranchInvalid => f.write_str("GIT_BRANCH_INVALID"),
            Self::GitBranchNotFound => f.write_str("GIT_BRANCH_NOT_FOUND"),
            Self::GitBranchSwitchFailed => f.write_str("GIT_BRANCH_SWITCH_FAILED"),
            Self::GitMutationInProgress => f.write_str("GIT_MUTATION_IN_PROGRESS"),
            Self::GitRepositoryReadOnly => f.write_str("GIT_REPOSITORY_READ_ONLY"),
            Self::CommitMessageGenerationFailed => f.write_str("COMMIT_MESSAGE_GENERATION_FAILED"),
            Self::UpdateNotAvailable => f.write_str("UPDATE_NOT_AVAILABLE"),
            Self::UpdateCheckFailed => f.write_str("UPDATE_CHECK_FAILED"),
            Self::UpdateInstallFailed => f.write_str("UPDATE_INSTALL_FAILED"),
            Self::ProviderError => f.write_str("PROVIDER_ERROR"),
        }
    }
}
impl ::std::str::FromStr for CodeAgentErrorMutationCode {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "ACCESS_DENIED" => Ok(Self::AccessDenied),
            "IDEMPOTENCY_KEY_REQUIRED" => Ok(Self::IdempotencyKeyRequired),
            "IDEMPOTENCY_CONFLICT" => Ok(Self::IdempotencyConflict),
            "IDEMPOTENCY_CAPACITY_EXCEEDED" => Ok(Self::IdempotencyCapacityExceeded),
            "INVALID_REQUEST" => Ok(Self::InvalidRequest),
            "PROJECT_NOT_FOUND" => Ok(Self::ProjectNotFound),
            "TASK_NOT_FOUND" => Ok(Self::TaskNotFound),
            "TURN_NOT_FOUND" => Ok(Self::TurnNotFound),
            "TURN_NOT_RUNNING" => Ok(Self::TurnNotRunning),
            "ATTACHMENT_NOT_FOUND" => Ok(Self::AttachmentNotFound),
            "PENDING_REQUEST_NOT_FOUND" => Ok(Self::PendingRequestNotFound),
            "PENDING_REQUEST_EXPIRED" => Ok(Self::PendingRequestExpired),
            "PENDING_REQUEST_ALREADY_RESOLVED" => Ok(Self::PendingRequestAlreadyResolved),
            "PENDING_REQUEST_MISMATCH" => Ok(Self::PendingRequestMismatch),
            "PAIRING_FAILED" => Ok(Self::PairingFailed),
            "PAIRING_RATE_LIMITED" => Ok(Self::PairingRateLimited),
            "GIT_STATUS_CHANGED" => Ok(Self::GitStatusChanged),
            "GIT_REPOSITORY_UNAVAILABLE" => Ok(Self::GitRepositoryUnavailable),
            "GIT_PATH_UNAVAILABLE" => Ok(Self::GitPathUnavailable),
            "GIT_COMMIT_FAILED" => Ok(Self::GitCommitFailed),
            "GIT_BRANCH_ALREADY_ACTIVE" => Ok(Self::GitBranchAlreadyActive),
            "GIT_BRANCH_ALREADY_EXISTS" => Ok(Self::GitBranchAlreadyExists),
            "GIT_BRANCH_CREATE_FAILED" => Ok(Self::GitBranchCreateFailed),
            "GIT_BRANCH_INVALID" => Ok(Self::GitBranchInvalid),
            "GIT_BRANCH_NOT_FOUND" => Ok(Self::GitBranchNotFound),
            "GIT_BRANCH_SWITCH_FAILED" => Ok(Self::GitBranchSwitchFailed),
            "GIT_MUTATION_IN_PROGRESS" => Ok(Self::GitMutationInProgress),
            "GIT_REPOSITORY_READ_ONLY" => Ok(Self::GitRepositoryReadOnly),
            "COMMIT_MESSAGE_GENERATION_FAILED" => Ok(Self::CommitMessageGenerationFailed),
            "UPDATE_NOT_AVAILABLE" => Ok(Self::UpdateNotAvailable),
            "UPDATE_CHECK_FAILED" => Ok(Self::UpdateCheckFailed),
            "UPDATE_INSTALL_FAILED" => Ok(Self::UpdateInstallFailed),
            "PROVIDER_ERROR" => Ok(Self::ProviderError),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for CodeAgentErrorMutationCode {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for CodeAgentErrorMutationCode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for CodeAgentErrorMutationCode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ConfigureCustomProviderRequest`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "baseUrl"
///  ],
///  "properties": {
///    "apiKey": {
///      "type": "string",
///      "maxLength": 16384,
///      "minLength": 1
///    },
///    "baseUrl": {
///      "type": "string",
///      "maxLength": 2048,
///      "minLength": 1
///    },
///    "models": {
///      "type": "array",
///      "items": {
///        "type": "object",
///        "required": [
///          "id",
///          "name"
///        ],
///        "properties": {
///          "id": {
///            "type": "string",
///            "maxLength": 256,
///            "minLength": 1,
///            "pattern": ".*\\S.*"
///          },
///          "name": {
///            "type": "string",
///            "maxLength": 256,
///            "minLength": 1,
///            "pattern": ".*\\S.*"
///          }
///        },
///        "additionalProperties": false
///      },
///      "maxItems": 1000
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ConfigureCustomProviderRequest {
    #[serde(
        rename = "apiKey",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub api_key: ::std::option::Option<ConfigureCustomProviderRequestApiKey>,
    #[serde(rename = "baseUrl")]
    pub base_url: ConfigureCustomProviderRequestBaseUrl,
    #[serde(default, skip_serializing_if = "::std::vec::Vec::is_empty")]
    pub models: ::std::vec::Vec<ConfigureCustomProviderRequestModelsItem>,
}
///`ConfigureCustomProviderRequestApiKey`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 16384,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ConfigureCustomProviderRequestApiKey(::std::string::String);
impl ::std::ops::Deref for ConfigureCustomProviderRequestApiKey {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ConfigureCustomProviderRequestApiKey> for ::std::string::String {
    fn from(value: ConfigureCustomProviderRequestApiKey) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ConfigureCustomProviderRequestApiKey {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 16384usize {
            return Err("longer than 16384 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ConfigureCustomProviderRequestApiKey {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ConfigureCustomProviderRequestApiKey {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ConfigureCustomProviderRequestApiKey {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ConfigureCustomProviderRequestApiKey {
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
///`ConfigureCustomProviderRequestBaseUrl`
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
pub struct ConfigureCustomProviderRequestBaseUrl(::std::string::String);
impl ::std::ops::Deref for ConfigureCustomProviderRequestBaseUrl {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ConfigureCustomProviderRequestBaseUrl> for ::std::string::String {
    fn from(value: ConfigureCustomProviderRequestBaseUrl) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ConfigureCustomProviderRequestBaseUrl {
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
impl ::std::convert::TryFrom<&str> for ConfigureCustomProviderRequestBaseUrl {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ConfigureCustomProviderRequestBaseUrl {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ConfigureCustomProviderRequestBaseUrl {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ConfigureCustomProviderRequestBaseUrl {
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
///`ConfigureCustomProviderRequestModelsItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "id",
///    "name"
///  ],
///  "properties": {
///    "id": {
///      "type": "string",
///      "maxLength": 256,
///      "minLength": 1,
///      "pattern": ".*\\S.*"
///    },
///    "name": {
///      "type": "string",
///      "maxLength": 256,
///      "minLength": 1,
///      "pattern": ".*\\S.*"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ConfigureCustomProviderRequestModelsItem {
    pub id: ConfigureCustomProviderRequestModelsItemId,
    pub name: ConfigureCustomProviderRequestModelsItemName,
}
///`ConfigureCustomProviderRequestModelsItemId`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 256,
///  "minLength": 1,
///  "pattern": ".*\\S.*"
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ConfigureCustomProviderRequestModelsItemId(::std::string::String);
impl ::std::ops::Deref for ConfigureCustomProviderRequestModelsItemId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ConfigureCustomProviderRequestModelsItemId> for ::std::string::String {
    fn from(value: ConfigureCustomProviderRequestModelsItemId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ConfigureCustomProviderRequestModelsItemId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 256usize {
            return Err("longer than 256 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        static PATTERN: ::std::sync::LazyLock<::regress::Regex> =
            ::std::sync::LazyLock::new(|| ::regress::Regex::new(".*\\S.*").unwrap());
        if PATTERN.find(value).is_none() {
            return Err("doesn't match pattern \".*\\S.*\"".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ConfigureCustomProviderRequestModelsItemId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ConfigureCustomProviderRequestModelsItemId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ConfigureCustomProviderRequestModelsItemId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ConfigureCustomProviderRequestModelsItemId {
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
///`ConfigureCustomProviderRequestModelsItemName`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 256,
///  "minLength": 1,
///  "pattern": ".*\\S.*"
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ConfigureCustomProviderRequestModelsItemName(::std::string::String);
impl ::std::ops::Deref for ConfigureCustomProviderRequestModelsItemName {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ConfigureCustomProviderRequestModelsItemName> for ::std::string::String {
    fn from(value: ConfigureCustomProviderRequestModelsItemName) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ConfigureCustomProviderRequestModelsItemName {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 256usize {
            return Err("longer than 256 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        static PATTERN: ::std::sync::LazyLock<::regress::Regex> =
            ::std::sync::LazyLock::new(|| ::regress::Regex::new(".*\\S.*").unwrap());
        if PATTERN.find(value).is_none() {
            return Err("doesn't match pattern \".*\\S.*\"".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ConfigureCustomProviderRequestModelsItemName {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ConfigureCustomProviderRequestModelsItemName
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ConfigureCustomProviderRequestModelsItemName
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ConfigureCustomProviderRequestModelsItemName {
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
///`ConfigureCustomProviderResponse`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "models",
///    "status"
///  ],
///  "properties": {
///    "models": {
///      "type": "object",
///      "required": [
///        "data",
///        "nextCursor"
///      ],
///      "properties": {
///        "data": {
///          "type": "array",
///          "items": {
///            "type": "object",
///            "required": [
///              "defaultReasoningEffort",
///              "description",
///              "displayName",
///              "id",
///              "isDefault",
///              "supportedReasoningEfforts"
///            ],
///            "properties": {
///              "defaultReasoningEffort": {
///                "type": "string",
///                "minLength": 1
///              },
///              "description": {
///                "type": "string"
///              },
///              "displayName": {
///                "type": "string",
///                "minLength": 1
///              },
///              "id": {
///                "type": "string",
///                "minLength": 1
///              },
///              "isDefault": {
///                "type": "boolean"
///              },
///              "supportedReasoningEfforts": {
///                "type": "array",
///                "items": {
///                  "type": "object",
///                  "required": [
///                    "description",
///                    "id"
///                  ],
///                  "properties": {
///                    "description": {
///                      "type": "string"
///                    },
///                    "id": {
///                      "type": "string",
///                      "minLength": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                "minItems": 1
///              }
///            },
///            "additionalProperties": false
///          }
///        },
///        "nextCursor": {
///          "oneOf": [
///            {
///              "type": "string"
///            },
///            {
///              "type": "null"
///            }
///          ]
///        }
///      },
///      "additionalProperties": false
///    },
///    "status": {
///      "type": "object",
///      "required": [
///        "account",
///        "customBaseUrl",
///        "mode",
///        "pendingLogin",
///        "state"
///      ],
///      "properties": {
///        "account": {
///          "oneOf": [
///            {
///              "oneOf": [
///                {
///                  "type": "object",
///                  "required": [
///                    "email",
///                    "planType",
///                    "type"
///                  ],
///                  "properties": {
///                    "email": {
///                      "oneOf": [
///                        {
///                          "type": "string",
///                          "maxLength": 320
///                        },
///                        {
///                          "type": "null"
///                        }
///                      ]
///                    },
///                    "planType": {
///                      "oneOf": [
///                        {
///                          "type": "string",
///                          "maxLength": 64
///                        },
///                        {
///                          "type": "null"
///                        }
///                      ]
///                    },
///                    "type": {
///                      "type": "string",
///                      "const": "chatgpt"
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "type"
///                  ],
///                  "properties": {
///                    "type": {
///                      "type": "string",
///                      "const": "apiKey"
///                    }
///                  },
///                  "additionalProperties": false
///                }
///              ]
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "customBaseUrl": {
///          "oneOf": [
///            {
///              "type": "string",
///              "maxLength": 2048,
///              "minLength": 1
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "mode": {
///          "oneOf": [
///            {
///              "type": "string",
///              "const": "official"
///            },
///            {
///              "type": "string",
///              "const": "custom"
///            }
///          ]
///        },
///        "pendingLogin": {
///          "oneOf": [
///            {
///              "type": "object",
///              "required": [
///                "error",
///                "loginId",
///                "state"
///              ],
///              "properties": {
///                "error": {
///                  "oneOf": [
///                    {
///                      "type": "string"
///                    },
///                    {
///                      "type": "null"
///                    }
///                  ]
///                },
///                "loginId": {
///                  "type": "string",
///                  "maxLength": 256,
///                  "minLength": 1
///                },
///                "state": {
///                  "oneOf": [
///                    {
///                      "type": "string",
///                      "const": "pending"
///                    },
///                    {
///                      "type": "string",
///                      "const": "failed"
///                    }
///                  ]
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "state": {
///          "oneOf": [
///            {
///              "type": "string",
///              "const": "disconnected"
///            },
///            {
///              "type": "string",
///              "const": "pending"
///            },
///            {
///              "type": "string",
///              "const": "connected"
///            },
///            {
///              "type": "string",
///              "const": "failed"
///            }
///          ]
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
pub struct ConfigureCustomProviderResponse {
    pub models: ConfigureCustomProviderResponseModels,
    pub status: ConfigureCustomProviderResponseStatus,
}
///`ConfigureCustomProviderResponseModels`
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
pub struct ConfigureCustomProviderResponseModels {
    pub data: ::std::vec::Vec<ConfigureCustomProviderResponseModelsDataItem>,
    #[serde(rename = "nextCursor")]
    pub next_cursor: ::std::option::Option<::std::string::String>,
}
///`ConfigureCustomProviderResponseModelsDataItem`
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
pub struct ConfigureCustomProviderResponseModelsDataItem {
    #[serde(rename = "defaultReasoningEffort")]
    pub default_reasoning_effort:
        ConfigureCustomProviderResponseModelsDataItemDefaultReasoningEffort,
    pub description: ::std::string::String,
    #[serde(rename = "displayName")]
    pub display_name: ConfigureCustomProviderResponseModelsDataItemDisplayName,
    pub id: ConfigureCustomProviderResponseModelsDataItemId,
    #[serde(rename = "isDefault")]
    pub is_default: bool,
    #[serde(rename = "supportedReasoningEfforts")]
    pub supported_reasoning_efforts:
        ::std::vec::Vec<ConfigureCustomProviderResponseModelsDataItemSupportedReasoningEffortsItem>,
}
///`ConfigureCustomProviderResponseModelsDataItemDefaultReasoningEffort`
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
pub struct ConfigureCustomProviderResponseModelsDataItemDefaultReasoningEffort(
    ::std::string::String,
);
impl ::std::ops::Deref for ConfigureCustomProviderResponseModelsDataItemDefaultReasoningEffort {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ConfigureCustomProviderResponseModelsDataItemDefaultReasoningEffort>
    for ::std::string::String
{
    fn from(value: ConfigureCustomProviderResponseModelsDataItemDefaultReasoningEffort) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ConfigureCustomProviderResponseModelsDataItemDefaultReasoningEffort {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ConfigureCustomProviderResponseModelsDataItemDefaultReasoningEffort
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ConfigureCustomProviderResponseModelsDataItemDefaultReasoningEffort
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ConfigureCustomProviderResponseModelsDataItemDefaultReasoningEffort
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ConfigureCustomProviderResponseModelsDataItemDefaultReasoningEffort
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
///`ConfigureCustomProviderResponseModelsDataItemDisplayName`
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
pub struct ConfigureCustomProviderResponseModelsDataItemDisplayName(::std::string::String);
impl ::std::ops::Deref for ConfigureCustomProviderResponseModelsDataItemDisplayName {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ConfigureCustomProviderResponseModelsDataItemDisplayName>
    for ::std::string::String
{
    fn from(value: ConfigureCustomProviderResponseModelsDataItemDisplayName) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ConfigureCustomProviderResponseModelsDataItemDisplayName {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ConfigureCustomProviderResponseModelsDataItemDisplayName {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ConfigureCustomProviderResponseModelsDataItemDisplayName
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ConfigureCustomProviderResponseModelsDataItemDisplayName
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ConfigureCustomProviderResponseModelsDataItemDisplayName {
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
///`ConfigureCustomProviderResponseModelsDataItemId`
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
pub struct ConfigureCustomProviderResponseModelsDataItemId(::std::string::String);
impl ::std::ops::Deref for ConfigureCustomProviderResponseModelsDataItemId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ConfigureCustomProviderResponseModelsDataItemId>
    for ::std::string::String
{
    fn from(value: ConfigureCustomProviderResponseModelsDataItemId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ConfigureCustomProviderResponseModelsDataItemId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ConfigureCustomProviderResponseModelsDataItemId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ConfigureCustomProviderResponseModelsDataItemId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ConfigureCustomProviderResponseModelsDataItemId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ConfigureCustomProviderResponseModelsDataItemId {
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
///`ConfigureCustomProviderResponseModelsDataItemSupportedReasoningEffortsItem`
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
pub struct ConfigureCustomProviderResponseModelsDataItemSupportedReasoningEffortsItem {
    pub description: ::std::string::String,
    pub id: ConfigureCustomProviderResponseModelsDataItemSupportedReasoningEffortsItemId,
}
///`ConfigureCustomProviderResponseModelsDataItemSupportedReasoningEffortsItemId`
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
pub struct ConfigureCustomProviderResponseModelsDataItemSupportedReasoningEffortsItemId(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ConfigureCustomProviderResponseModelsDataItemSupportedReasoningEffortsItemId
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl
    ::std::convert::From<
        ConfigureCustomProviderResponseModelsDataItemSupportedReasoningEffortsItemId,
    > for ::std::string::String
{
    fn from(
        value: ConfigureCustomProviderResponseModelsDataItemSupportedReasoningEffortsItemId,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ConfigureCustomProviderResponseModelsDataItemSupportedReasoningEffortsItemId
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
    for ConfigureCustomProviderResponseModelsDataItemSupportedReasoningEffortsItemId
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ConfigureCustomProviderResponseModelsDataItemSupportedReasoningEffortsItemId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ConfigureCustomProviderResponseModelsDataItemSupportedReasoningEffortsItemId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ConfigureCustomProviderResponseModelsDataItemSupportedReasoningEffortsItemId
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
///`ConfigureCustomProviderResponseStatus`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "account",
///    "customBaseUrl",
///    "mode",
///    "pendingLogin",
///    "state"
///  ],
///  "properties": {
///    "account": {
///      "oneOf": [
///        {
///          "oneOf": [
///            {
///              "type": "object",
///              "required": [
///                "email",
///                "planType",
///                "type"
///              ],
///              "properties": {
///                "email": {
///                  "oneOf": [
///                    {
///                      "type": "string",
///                      "maxLength": 320
///                    },
///                    {
///                      "type": "null"
///                    }
///                  ]
///                },
///                "planType": {
///                  "oneOf": [
///                    {
///                      "type": "string",
///                      "maxLength": 64
///                    },
///                    {
///                      "type": "null"
///                    }
///                  ]
///                },
///                "type": {
///                  "type": "string",
///                  "const": "chatgpt"
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "type"
///              ],
///              "properties": {
///                "type": {
///                  "type": "string",
///                  "const": "apiKey"
///                }
///              },
///              "additionalProperties": false
///            }
///          ]
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
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
///    "pendingLogin": {
///      "oneOf": [
///        {
///          "type": "object",
///          "required": [
///            "error",
///            "loginId",
///            "state"
///          ],
///          "properties": {
///            "error": {
///              "oneOf": [
///                {
///                  "type": "string"
///                },
///                {
///                  "type": "null"
///                }
///              ]
///            },
///            "loginId": {
///              "type": "string",
///              "maxLength": 256,
///              "minLength": 1
///            },
///            "state": {
///              "oneOf": [
///                {
///                  "type": "string",
///                  "const": "pending"
///                },
///                {
///                  "type": "string",
///                  "const": "failed"
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
///    "state": {
///      "oneOf": [
///        {
///          "type": "string",
///          "const": "disconnected"
///        },
///        {
///          "type": "string",
///          "const": "pending"
///        },
///        {
///          "type": "string",
///          "const": "connected"
///        },
///        {
///          "type": "string",
///          "const": "failed"
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
pub struct ConfigureCustomProviderResponseStatus {
    pub account: ::std::option::Option<ConfigureCustomProviderResponseStatusAccount>,
    #[serde(rename = "customBaseUrl")]
    pub custom_base_url: ::std::option::Option<ConfigureCustomProviderResponseStatusCustomBaseUrl>,
    pub mode: ConfigureCustomProviderResponseStatusMode,
    #[serde(rename = "pendingLogin")]
    pub pending_login: ::std::option::Option<ConfigureCustomProviderResponseStatusPendingLogin>,
    pub state: ConfigureCustomProviderResponseStatusState,
}
///`ConfigureCustomProviderResponseStatusAccount`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "object",
///      "required": [
///        "email",
///        "planType",
///        "type"
///      ],
///      "properties": {
///        "email": {
///          "oneOf": [
///            {
///              "type": "string",
///              "maxLength": 320
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "planType": {
///          "oneOf": [
///            {
///              "type": "string",
///              "maxLength": 64
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "type": {
///          "type": "string",
///          "const": "chatgpt"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "type"
///      ],
///      "properties": {
///        "type": {
///          "type": "string",
///          "const": "apiKey"
///        }
///      },
///      "additionalProperties": false
///    }
///  ]
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum ConfigureCustomProviderResponseStatusAccount {
    #[serde(rename = "chatgpt")]
    Chatgpt {
        email: ::std::option::Option<ConfigureCustomProviderResponseStatusAccountEmail>,
        #[serde(rename = "planType")]
        plan_type: ::std::option::Option<ConfigureCustomProviderResponseStatusAccountPlanType>,
    },
    #[serde(rename = "apiKey")]
    ApiKey,
}
///`ConfigureCustomProviderResponseStatusAccountEmail`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 320
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ConfigureCustomProviderResponseStatusAccountEmail(::std::string::String);
impl ::std::ops::Deref for ConfigureCustomProviderResponseStatusAccountEmail {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ConfigureCustomProviderResponseStatusAccountEmail>
    for ::std::string::String
{
    fn from(value: ConfigureCustomProviderResponseStatusAccountEmail) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ConfigureCustomProviderResponseStatusAccountEmail {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 320usize {
            return Err("longer than 320 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ConfigureCustomProviderResponseStatusAccountEmail {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ConfigureCustomProviderResponseStatusAccountEmail
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ConfigureCustomProviderResponseStatusAccountEmail
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ConfigureCustomProviderResponseStatusAccountEmail {
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
///`ConfigureCustomProviderResponseStatusAccountPlanType`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 64
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ConfigureCustomProviderResponseStatusAccountPlanType(::std::string::String);
impl ::std::ops::Deref for ConfigureCustomProviderResponseStatusAccountPlanType {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ConfigureCustomProviderResponseStatusAccountPlanType>
    for ::std::string::String
{
    fn from(value: ConfigureCustomProviderResponseStatusAccountPlanType) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ConfigureCustomProviderResponseStatusAccountPlanType {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 64usize {
            return Err("longer than 64 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ConfigureCustomProviderResponseStatusAccountPlanType {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ConfigureCustomProviderResponseStatusAccountPlanType
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ConfigureCustomProviderResponseStatusAccountPlanType
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ConfigureCustomProviderResponseStatusAccountPlanType {
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
///`ConfigureCustomProviderResponseStatusCustomBaseUrl`
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
pub struct ConfigureCustomProviderResponseStatusCustomBaseUrl(::std::string::String);
impl ::std::ops::Deref for ConfigureCustomProviderResponseStatusCustomBaseUrl {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ConfigureCustomProviderResponseStatusCustomBaseUrl>
    for ::std::string::String
{
    fn from(value: ConfigureCustomProviderResponseStatusCustomBaseUrl) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ConfigureCustomProviderResponseStatusCustomBaseUrl {
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
impl ::std::convert::TryFrom<&str> for ConfigureCustomProviderResponseStatusCustomBaseUrl {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ConfigureCustomProviderResponseStatusCustomBaseUrl
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ConfigureCustomProviderResponseStatusCustomBaseUrl
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ConfigureCustomProviderResponseStatusCustomBaseUrl {
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
///`ConfigureCustomProviderResponseStatusMode`
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
pub enum ConfigureCustomProviderResponseStatusMode {
    #[serde(rename = "official")]
    Official,
    #[serde(rename = "custom")]
    Custom,
}
impl ::std::fmt::Display for ConfigureCustomProviderResponseStatusMode {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Official => f.write_str("official"),
            Self::Custom => f.write_str("custom"),
        }
    }
}
impl ::std::str::FromStr for ConfigureCustomProviderResponseStatusMode {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "official" => Ok(Self::Official),
            "custom" => Ok(Self::Custom),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ConfigureCustomProviderResponseStatusMode {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ConfigureCustomProviderResponseStatusMode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ConfigureCustomProviderResponseStatusMode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ConfigureCustomProviderResponseStatusPendingLogin`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "error",
///    "loginId",
///    "state"
///  ],
///  "properties": {
///    "error": {
///      "oneOf": [
///        {
///          "type": "string"
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "loginId": {
///      "type": "string",
///      "maxLength": 256,
///      "minLength": 1
///    },
///    "state": {
///      "oneOf": [
///        {
///          "type": "string",
///          "const": "pending"
///        },
///        {
///          "type": "string",
///          "const": "failed"
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
pub struct ConfigureCustomProviderResponseStatusPendingLogin {
    pub error: ::std::option::Option<::std::string::String>,
    #[serde(rename = "loginId")]
    pub login_id: ConfigureCustomProviderResponseStatusPendingLoginLoginId,
    pub state: ConfigureCustomProviderResponseStatusPendingLoginState,
}
///`ConfigureCustomProviderResponseStatusPendingLoginLoginId`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 256,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ConfigureCustomProviderResponseStatusPendingLoginLoginId(::std::string::String);
impl ::std::ops::Deref for ConfigureCustomProviderResponseStatusPendingLoginLoginId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ConfigureCustomProviderResponseStatusPendingLoginLoginId>
    for ::std::string::String
{
    fn from(value: ConfigureCustomProviderResponseStatusPendingLoginLoginId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ConfigureCustomProviderResponseStatusPendingLoginLoginId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 256usize {
            return Err("longer than 256 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ConfigureCustomProviderResponseStatusPendingLoginLoginId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ConfigureCustomProviderResponseStatusPendingLoginLoginId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ConfigureCustomProviderResponseStatusPendingLoginLoginId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ConfigureCustomProviderResponseStatusPendingLoginLoginId {
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
///`ConfigureCustomProviderResponseStatusPendingLoginState`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "string",
///      "const": "pending"
///    },
///    {
///      "type": "string",
///      "const": "failed"
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
pub enum ConfigureCustomProviderResponseStatusPendingLoginState {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "failed")]
    Failed,
}
impl ::std::fmt::Display for ConfigureCustomProviderResponseStatusPendingLoginState {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Pending => f.write_str("pending"),
            Self::Failed => f.write_str("failed"),
        }
    }
}
impl ::std::str::FromStr for ConfigureCustomProviderResponseStatusPendingLoginState {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "pending" => Ok(Self::Pending),
            "failed" => Ok(Self::Failed),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ConfigureCustomProviderResponseStatusPendingLoginState {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ConfigureCustomProviderResponseStatusPendingLoginState
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ConfigureCustomProviderResponseStatusPendingLoginState
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ConfigureCustomProviderResponseStatusState`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "string",
///      "const": "disconnected"
///    },
///    {
///      "type": "string",
///      "const": "pending"
///    },
///    {
///      "type": "string",
///      "const": "connected"
///    },
///    {
///      "type": "string",
///      "const": "failed"
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
pub enum ConfigureCustomProviderResponseStatusState {
    #[serde(rename = "disconnected")]
    Disconnected,
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "connected")]
    Connected,
    #[serde(rename = "failed")]
    Failed,
}
impl ::std::fmt::Display for ConfigureCustomProviderResponseStatusState {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Disconnected => f.write_str("disconnected"),
            Self::Pending => f.write_str("pending"),
            Self::Connected => f.write_str("connected"),
            Self::Failed => f.write_str("failed"),
        }
    }
}
impl ::std::str::FromStr for ConfigureCustomProviderResponseStatusState {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "disconnected" => Ok(Self::Disconnected),
            "pending" => Ok(Self::Pending),
            "connected" => Ok(Self::Connected),
            "failed" => Ok(Self::Failed),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ConfigureCustomProviderResponseStatusState {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ConfigureCustomProviderResponseStatusState
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ConfigureCustomProviderResponseStatusState {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ConnectionReady`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "latestSequence",
///    "sessionId",
///    "type",
///    "version"
///  ],
///  "properties": {
///    "latestSequence": {
///      "type": "integer",
///      "minimum": 0.0
///    },
///    "sessionId": {
///      "type": "string",
///      "minLength": 1
///    },
///    "type": {
///      "type": "string",
///      "const": "connection.ready"
///    },
///    "version": {
///      "type": "number",
///      "const": 2
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ConnectionReady {
    #[serde(rename = "latestSequence")]
    pub latest_sequence: u64,
    #[serde(rename = "sessionId")]
    pub session_id: ConnectionReadySessionId,
    #[serde(rename = "type")]
    pub type_: ::std::string::String,
    pub version: f64,
}
///`ConnectionReadySessionId`
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
pub struct ConnectionReadySessionId(::std::string::String);
impl ::std::ops::Deref for ConnectionReadySessionId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ConnectionReadySessionId> for ::std::string::String {
    fn from(value: ConnectionReadySessionId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ConnectionReadySessionId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ConnectionReadySessionId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ConnectionReadySessionId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ConnectionReadySessionId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ConnectionReadySessionId {
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
///`EventCheckpoint`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "sequence",
///    "sessionId"
///  ],
///  "properties": {
///    "sequence": {
///      "type": "integer",
///      "minimum": 0.0
///    },
///    "sessionId": {
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
pub struct EventCheckpoint {
    pub sequence: u64,
    #[serde(rename = "sessionId")]
    pub session_id: EventCheckpointSessionId,
}
///`EventCheckpointSessionId`
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
pub struct EventCheckpointSessionId(::std::string::String);
impl ::std::ops::Deref for EventCheckpointSessionId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<EventCheckpointSessionId> for ::std::string::String {
    fn from(value: EventCheckpointSessionId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for EventCheckpointSessionId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for EventCheckpointSessionId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for EventCheckpointSessionId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for EventCheckpointSessionId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for EventCheckpointSessionId {
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
///`GenerateCommitMessageRequest`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "expectedSnapshot",
///    "paths"
///  ],
///  "properties": {
///    "expectedSnapshot": {
///      "type": "string",
///      "maxLength": 64,
///      "minLength": 64,
///      "pattern": "^[a-f0-9]{64}$"
///    },
///    "paths": {
///      "type": "array",
///      "items": {
///        "type": "string",
///        "minLength": 1,
///        "pattern": "^(?![A-Za-z]:)(?!/)(?!.*(?:^|/)\\.\\.?(?:/|$))(?!.*//)(?!.*\\\\)(?!.*\\/$).+$"
///      },
///      "maxItems": 500,
///      "minItems": 1,
///      "uniqueItems": true
///    },
///    "repository": {
///      "type": "string",
///      "maxLength": 1024,
///      "minLength": 1,
///      "pattern": "^(?!\\.{1,2}$)(?!.*[\\u0000\\r\\n])[^/\\\\]+$"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct GenerateCommitMessageRequest {
    #[serde(rename = "expectedSnapshot")]
    pub expected_snapshot: GenerateCommitMessageRequestExpectedSnapshot,
    pub paths: Vec<GenerateCommitMessageRequestPathsItem>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub repository: ::std::option::Option<GenerateCommitMessageRequestRepository>,
}
///`GenerateCommitMessageRequestExpectedSnapshot`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 64,
///  "minLength": 64,
///  "pattern": "^[a-f0-9]{64}$"
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct GenerateCommitMessageRequestExpectedSnapshot(::std::string::String);
impl ::std::ops::Deref for GenerateCommitMessageRequestExpectedSnapshot {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<GenerateCommitMessageRequestExpectedSnapshot> for ::std::string::String {
    fn from(value: GenerateCommitMessageRequestExpectedSnapshot) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for GenerateCommitMessageRequestExpectedSnapshot {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 64usize {
            return Err("longer than 64 characters".into());
        }
        if value.chars().count() < 64usize {
            return Err("shorter than 64 characters".into());
        }
        static PATTERN: ::std::sync::LazyLock<::regress::Regex> =
            ::std::sync::LazyLock::new(|| ::regress::Regex::new("^[a-f0-9]{64}$").unwrap());
        if PATTERN.find(value).is_none() {
            return Err("doesn't match pattern \"^[a-f0-9]{64}$\"".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for GenerateCommitMessageRequestExpectedSnapshot {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for GenerateCommitMessageRequestExpectedSnapshot
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for GenerateCommitMessageRequestExpectedSnapshot
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for GenerateCommitMessageRequestExpectedSnapshot {
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
///`GenerateCommitMessageRequestPathsItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1,
///  "pattern": "^(?![A-Za-z]:)(?!/)(?!.*(?:^|/)\\.\\.?(?:/|$))(?!.*//)(?!.*\\\\)(?!.*\\/$).+$"
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct GenerateCommitMessageRequestPathsItem(::std::string::String);
impl ::std::ops::Deref for GenerateCommitMessageRequestPathsItem {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<GenerateCommitMessageRequestPathsItem> for ::std::string::String {
    fn from(value: GenerateCommitMessageRequestPathsItem) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for GenerateCommitMessageRequestPathsItem {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        static PATTERN: ::std::sync::LazyLock<::regress::Regex> =
            ::std::sync::LazyLock::new(|| {
                ::regress::Regex::new(
                    "^(?![A-Za-z]:)(?!/)(?!.*(?:^|/)\\.\\.?(?:/|$))(?!.*//)(?!.*\\\\)(?!.*\\/$).+$",
                )
                .unwrap()
            });
        if PATTERN.find(value).is_none() {
            return Err(
                "doesn't match pattern \"^(?![A-Za-z]:)(?!/)(?!.*(?:^|/)\\.\\.?(?:/|$))(?!.*//)(?!.*\\\\)(?!.*\\/$).+$\""
                    .into(),
            );
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for GenerateCommitMessageRequestPathsItem {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for GenerateCommitMessageRequestPathsItem {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for GenerateCommitMessageRequestPathsItem {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for GenerateCommitMessageRequestPathsItem {
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
///`GenerateCommitMessageRequestRepository`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 1024,
///  "minLength": 1,
///  "pattern": "^(?!\\.{1,2}$)(?!.*[\\u0000\\r\\n])[^/\\\\]+$"
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct GenerateCommitMessageRequestRepository(::std::string::String);
impl ::std::ops::Deref for GenerateCommitMessageRequestRepository {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<GenerateCommitMessageRequestRepository> for ::std::string::String {
    fn from(value: GenerateCommitMessageRequestRepository) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for GenerateCommitMessageRequestRepository {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 1024usize {
            return Err("longer than 1024 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        static PATTERN: ::std::sync::LazyLock<::regress::Regex> =
            ::std::sync::LazyLock::new(|| {
                ::regress::Regex::new("^(?!\\.{1,2}$)(?!.*[\\u0000\\r\\n])[^/\\\\]+$").unwrap()
            });
        if PATTERN.find(value).is_none() {
            return Err(
                "doesn't match pattern \"^(?!\\.{1,2}$)(?!.*[\\u0000\\r\\n])[^/\\\\]+$\"".into(),
            );
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for GenerateCommitMessageRequestRepository {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for GenerateCommitMessageRequestRepository {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for GenerateCommitMessageRequestRepository {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for GenerateCommitMessageRequestRepository {
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
///`GenerateCommitMessageResponse`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "message",
///    "snapshot"
///  ],
///  "properties": {
///    "message": {
///      "type": "string",
///      "maxLength": 10000,
///      "minLength": 1,
///      "pattern": "\\S"
///    },
///    "snapshot": {
///      "type": "string",
///      "maxLength": 64,
///      "minLength": 64,
///      "pattern": "^[a-f0-9]{64}$"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct GenerateCommitMessageResponse {
    pub message: GenerateCommitMessageResponseMessage,
    pub snapshot: GenerateCommitMessageResponseSnapshot,
}
///`GenerateCommitMessageResponseMessage`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 10000,
///  "minLength": 1,
///  "pattern": "\\S"
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct GenerateCommitMessageResponseMessage(::std::string::String);
impl ::std::ops::Deref for GenerateCommitMessageResponseMessage {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<GenerateCommitMessageResponseMessage> for ::std::string::String {
    fn from(value: GenerateCommitMessageResponseMessage) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for GenerateCommitMessageResponseMessage {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 10000usize {
            return Err("longer than 10000 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        static PATTERN: ::std::sync::LazyLock<::regress::Regex> =
            ::std::sync::LazyLock::new(|| ::regress::Regex::new("\\S").unwrap());
        if PATTERN.find(value).is_none() {
            return Err("doesn't match pattern \"\\S\"".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for GenerateCommitMessageResponseMessage {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for GenerateCommitMessageResponseMessage {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for GenerateCommitMessageResponseMessage {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for GenerateCommitMessageResponseMessage {
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
///`GenerateCommitMessageResponseSnapshot`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 64,
///  "minLength": 64,
///  "pattern": "^[a-f0-9]{64}$"
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct GenerateCommitMessageResponseSnapshot(::std::string::String);
impl ::std::ops::Deref for GenerateCommitMessageResponseSnapshot {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<GenerateCommitMessageResponseSnapshot> for ::std::string::String {
    fn from(value: GenerateCommitMessageResponseSnapshot) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for GenerateCommitMessageResponseSnapshot {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 64usize {
            return Err("longer than 64 characters".into());
        }
        if value.chars().count() < 64usize {
            return Err("shorter than 64 characters".into());
        }
        static PATTERN: ::std::sync::LazyLock<::regress::Regex> =
            ::std::sync::LazyLock::new(|| ::regress::Regex::new("^[a-f0-9]{64}$").unwrap());
        if PATTERN.find(value).is_none() {
            return Err("doesn't match pattern \"^[a-f0-9]{64}$\"".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for GenerateCommitMessageResponseSnapshot {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for GenerateCommitMessageResponseSnapshot {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for GenerateCommitMessageResponseSnapshot {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for GenerateCommitMessageResponseSnapshot {
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
///`ResyncRequired`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "latestSequence",
///    "reason",
///    "sessionId",
///    "type",
///    "version"
///  ],
///  "properties": {
///    "latestSequence": {
///      "type": "integer",
///      "minimum": 0.0
///    },
///    "reason": {
///      "oneOf": [
///        {
///          "type": "string",
///          "const": "event_retention_exceeded"
///        },
///        {
///          "type": "string",
///          "const": "session_changed"
///        },
///        {
///          "type": "string",
///          "const": "sequence_gap"
///        }
///      ]
///    },
///    "sessionId": {
///      "type": "string",
///      "minLength": 1
///    },
///    "type": {
///      "type": "string",
///      "const": "resync.required"
///    },
///    "version": {
///      "type": "number",
///      "const": 2
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ResyncRequired {
    #[serde(rename = "latestSequence")]
    pub latest_sequence: u64,
    pub reason: ResyncRequiredReason,
    #[serde(rename = "sessionId")]
    pub session_id: ResyncRequiredSessionId,
    #[serde(rename = "type")]
    pub type_: ::std::string::String,
    pub version: f64,
}
///`ResyncRequiredReason`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "string",
///      "const": "event_retention_exceeded"
///    },
///    {
///      "type": "string",
///      "const": "session_changed"
///    },
///    {
///      "type": "string",
///      "const": "sequence_gap"
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
pub enum ResyncRequiredReason {
    #[serde(rename = "event_retention_exceeded")]
    EventRetentionExceeded,
    #[serde(rename = "session_changed")]
    SessionChanged,
    #[serde(rename = "sequence_gap")]
    SequenceGap,
}
impl ::std::fmt::Display for ResyncRequiredReason {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::EventRetentionExceeded => f.write_str("event_retention_exceeded"),
            Self::SessionChanged => f.write_str("session_changed"),
            Self::SequenceGap => f.write_str("sequence_gap"),
        }
    }
}
impl ::std::str::FromStr for ResyncRequiredReason {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "event_retention_exceeded" => Ok(Self::EventRetentionExceeded),
            "session_changed" => Ok(Self::SessionChanged),
            "sequence_gap" => Ok(Self::SequenceGap),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ResyncRequiredReason {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ResyncRequiredReason {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ResyncRequiredReason {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ResyncRequiredSessionId`
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
pub struct ResyncRequiredSessionId(::std::string::String);
impl ::std::ops::Deref for ResyncRequiredSessionId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ResyncRequiredSessionId> for ::std::string::String {
    fn from(value: ResyncRequiredSessionId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ResyncRequiredSessionId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ResyncRequiredSessionId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ResyncRequiredSessionId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ResyncRequiredSessionId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ResyncRequiredSessionId {
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
///`StartOfficialProviderLoginResponse`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "authUrl",
///    "loginId",
///    "status"
///  ],
///  "properties": {
///    "authUrl": {
///      "type": "string",
///      "maxLength": 8192,
///      "minLength": 1
///    },
///    "loginId": {
///      "type": "string",
///      "maxLength": 256,
///      "minLength": 1
///    },
///    "status": {
///      "type": "object",
///      "required": [
///        "account",
///        "customBaseUrl",
///        "mode",
///        "pendingLogin",
///        "state"
///      ],
///      "properties": {
///        "account": {
///          "oneOf": [
///            {
///              "oneOf": [
///                {
///                  "type": "object",
///                  "required": [
///                    "email",
///                    "planType",
///                    "type"
///                  ],
///                  "properties": {
///                    "email": {
///                      "oneOf": [
///                        {
///                          "type": "string",
///                          "maxLength": 320
///                        },
///                        {
///                          "type": "null"
///                        }
///                      ]
///                    },
///                    "planType": {
///                      "oneOf": [
///                        {
///                          "type": "string",
///                          "maxLength": 64
///                        },
///                        {
///                          "type": "null"
///                        }
///                      ]
///                    },
///                    "type": {
///                      "type": "string",
///                      "const": "chatgpt"
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "type"
///                  ],
///                  "properties": {
///                    "type": {
///                      "type": "string",
///                      "const": "apiKey"
///                    }
///                  },
///                  "additionalProperties": false
///                }
///              ]
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "customBaseUrl": {
///          "oneOf": [
///            {
///              "type": "string",
///              "maxLength": 2048,
///              "minLength": 1
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "mode": {
///          "oneOf": [
///            {
///              "type": "string",
///              "const": "official"
///            },
///            {
///              "type": "string",
///              "const": "custom"
///            }
///          ]
///        },
///        "pendingLogin": {
///          "oneOf": [
///            {
///              "type": "object",
///              "required": [
///                "error",
///                "loginId",
///                "state"
///              ],
///              "properties": {
///                "error": {
///                  "oneOf": [
///                    {
///                      "type": "string"
///                    },
///                    {
///                      "type": "null"
///                    }
///                  ]
///                },
///                "loginId": {
///                  "type": "string",
///                  "maxLength": 256,
///                  "minLength": 1
///                },
///                "state": {
///                  "oneOf": [
///                    {
///                      "type": "string",
///                      "const": "pending"
///                    },
///                    {
///                      "type": "string",
///                      "const": "failed"
///                    }
///                  ]
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "state": {
///          "oneOf": [
///            {
///              "type": "string",
///              "const": "disconnected"
///            },
///            {
///              "type": "string",
///              "const": "pending"
///            },
///            {
///              "type": "string",
///              "const": "connected"
///            },
///            {
///              "type": "string",
///              "const": "failed"
///            }
///          ]
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
pub struct StartOfficialProviderLoginResponse {
    #[serde(rename = "authUrl")]
    pub auth_url: StartOfficialProviderLoginResponseAuthUrl,
    #[serde(rename = "loginId")]
    pub login_id: StartOfficialProviderLoginResponseLoginId,
    pub status: StartOfficialProviderLoginResponseStatus,
}
///`StartOfficialProviderLoginResponseAuthUrl`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 8192,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct StartOfficialProviderLoginResponseAuthUrl(::std::string::String);
impl ::std::ops::Deref for StartOfficialProviderLoginResponseAuthUrl {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<StartOfficialProviderLoginResponseAuthUrl> for ::std::string::String {
    fn from(value: StartOfficialProviderLoginResponseAuthUrl) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for StartOfficialProviderLoginResponseAuthUrl {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 8192usize {
            return Err("longer than 8192 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for StartOfficialProviderLoginResponseAuthUrl {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for StartOfficialProviderLoginResponseAuthUrl {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for StartOfficialProviderLoginResponseAuthUrl {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for StartOfficialProviderLoginResponseAuthUrl {
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
///`StartOfficialProviderLoginResponseLoginId`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 256,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct StartOfficialProviderLoginResponseLoginId(::std::string::String);
impl ::std::ops::Deref for StartOfficialProviderLoginResponseLoginId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<StartOfficialProviderLoginResponseLoginId> for ::std::string::String {
    fn from(value: StartOfficialProviderLoginResponseLoginId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for StartOfficialProviderLoginResponseLoginId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 256usize {
            return Err("longer than 256 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for StartOfficialProviderLoginResponseLoginId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for StartOfficialProviderLoginResponseLoginId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for StartOfficialProviderLoginResponseLoginId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for StartOfficialProviderLoginResponseLoginId {
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
///`StartOfficialProviderLoginResponseStatus`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "account",
///    "customBaseUrl",
///    "mode",
///    "pendingLogin",
///    "state"
///  ],
///  "properties": {
///    "account": {
///      "oneOf": [
///        {
///          "oneOf": [
///            {
///              "type": "object",
///              "required": [
///                "email",
///                "planType",
///                "type"
///              ],
///              "properties": {
///                "email": {
///                  "oneOf": [
///                    {
///                      "type": "string",
///                      "maxLength": 320
///                    },
///                    {
///                      "type": "null"
///                    }
///                  ]
///                },
///                "planType": {
///                  "oneOf": [
///                    {
///                      "type": "string",
///                      "maxLength": 64
///                    },
///                    {
///                      "type": "null"
///                    }
///                  ]
///                },
///                "type": {
///                  "type": "string",
///                  "const": "chatgpt"
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "type"
///              ],
///              "properties": {
///                "type": {
///                  "type": "string",
///                  "const": "apiKey"
///                }
///              },
///              "additionalProperties": false
///            }
///          ]
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
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
///    "pendingLogin": {
///      "oneOf": [
///        {
///          "type": "object",
///          "required": [
///            "error",
///            "loginId",
///            "state"
///          ],
///          "properties": {
///            "error": {
///              "oneOf": [
///                {
///                  "type": "string"
///                },
///                {
///                  "type": "null"
///                }
///              ]
///            },
///            "loginId": {
///              "type": "string",
///              "maxLength": 256,
///              "minLength": 1
///            },
///            "state": {
///              "oneOf": [
///                {
///                  "type": "string",
///                  "const": "pending"
///                },
///                {
///                  "type": "string",
///                  "const": "failed"
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
///    "state": {
///      "oneOf": [
///        {
///          "type": "string",
///          "const": "disconnected"
///        },
///        {
///          "type": "string",
///          "const": "pending"
///        },
///        {
///          "type": "string",
///          "const": "connected"
///        },
///        {
///          "type": "string",
///          "const": "failed"
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
pub struct StartOfficialProviderLoginResponseStatus {
    pub account: ::std::option::Option<StartOfficialProviderLoginResponseStatusAccount>,
    #[serde(rename = "customBaseUrl")]
    pub custom_base_url:
        ::std::option::Option<StartOfficialProviderLoginResponseStatusCustomBaseUrl>,
    pub mode: StartOfficialProviderLoginResponseStatusMode,
    #[serde(rename = "pendingLogin")]
    pub pending_login: ::std::option::Option<StartOfficialProviderLoginResponseStatusPendingLogin>,
    pub state: StartOfficialProviderLoginResponseStatusState,
}
///`StartOfficialProviderLoginResponseStatusAccount`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "object",
///      "required": [
///        "email",
///        "planType",
///        "type"
///      ],
///      "properties": {
///        "email": {
///          "oneOf": [
///            {
///              "type": "string",
///              "maxLength": 320
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "planType": {
///          "oneOf": [
///            {
///              "type": "string",
///              "maxLength": 64
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "type": {
///          "type": "string",
///          "const": "chatgpt"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "type"
///      ],
///      "properties": {
///        "type": {
///          "type": "string",
///          "const": "apiKey"
///        }
///      },
///      "additionalProperties": false
///    }
///  ]
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum StartOfficialProviderLoginResponseStatusAccount {
    #[serde(rename = "chatgpt")]
    Chatgpt {
        email: ::std::option::Option<StartOfficialProviderLoginResponseStatusAccountEmail>,
        #[serde(rename = "planType")]
        plan_type: ::std::option::Option<StartOfficialProviderLoginResponseStatusAccountPlanType>,
    },
    #[serde(rename = "apiKey")]
    ApiKey,
}
///`StartOfficialProviderLoginResponseStatusAccountEmail`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 320
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct StartOfficialProviderLoginResponseStatusAccountEmail(::std::string::String);
impl ::std::ops::Deref for StartOfficialProviderLoginResponseStatusAccountEmail {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<StartOfficialProviderLoginResponseStatusAccountEmail>
    for ::std::string::String
{
    fn from(value: StartOfficialProviderLoginResponseStatusAccountEmail) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for StartOfficialProviderLoginResponseStatusAccountEmail {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 320usize {
            return Err("longer than 320 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for StartOfficialProviderLoginResponseStatusAccountEmail {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for StartOfficialProviderLoginResponseStatusAccountEmail
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for StartOfficialProviderLoginResponseStatusAccountEmail
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for StartOfficialProviderLoginResponseStatusAccountEmail {
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
///`StartOfficialProviderLoginResponseStatusAccountPlanType`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 64
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct StartOfficialProviderLoginResponseStatusAccountPlanType(::std::string::String);
impl ::std::ops::Deref for StartOfficialProviderLoginResponseStatusAccountPlanType {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<StartOfficialProviderLoginResponseStatusAccountPlanType>
    for ::std::string::String
{
    fn from(value: StartOfficialProviderLoginResponseStatusAccountPlanType) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for StartOfficialProviderLoginResponseStatusAccountPlanType {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 64usize {
            return Err("longer than 64 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for StartOfficialProviderLoginResponseStatusAccountPlanType {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for StartOfficialProviderLoginResponseStatusAccountPlanType
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for StartOfficialProviderLoginResponseStatusAccountPlanType
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for StartOfficialProviderLoginResponseStatusAccountPlanType {
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
///`StartOfficialProviderLoginResponseStatusCustomBaseUrl`
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
pub struct StartOfficialProviderLoginResponseStatusCustomBaseUrl(::std::string::String);
impl ::std::ops::Deref for StartOfficialProviderLoginResponseStatusCustomBaseUrl {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<StartOfficialProviderLoginResponseStatusCustomBaseUrl>
    for ::std::string::String
{
    fn from(value: StartOfficialProviderLoginResponseStatusCustomBaseUrl) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for StartOfficialProviderLoginResponseStatusCustomBaseUrl {
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
impl ::std::convert::TryFrom<&str> for StartOfficialProviderLoginResponseStatusCustomBaseUrl {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for StartOfficialProviderLoginResponseStatusCustomBaseUrl
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for StartOfficialProviderLoginResponseStatusCustomBaseUrl
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for StartOfficialProviderLoginResponseStatusCustomBaseUrl {
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
///`StartOfficialProviderLoginResponseStatusMode`
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
pub enum StartOfficialProviderLoginResponseStatusMode {
    #[serde(rename = "official")]
    Official,
    #[serde(rename = "custom")]
    Custom,
}
impl ::std::fmt::Display for StartOfficialProviderLoginResponseStatusMode {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Official => f.write_str("official"),
            Self::Custom => f.write_str("custom"),
        }
    }
}
impl ::std::str::FromStr for StartOfficialProviderLoginResponseStatusMode {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "official" => Ok(Self::Official),
            "custom" => Ok(Self::Custom),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for StartOfficialProviderLoginResponseStatusMode {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for StartOfficialProviderLoginResponseStatusMode
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for StartOfficialProviderLoginResponseStatusMode
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`StartOfficialProviderLoginResponseStatusPendingLogin`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "error",
///    "loginId",
///    "state"
///  ],
///  "properties": {
///    "error": {
///      "oneOf": [
///        {
///          "type": "string"
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "loginId": {
///      "type": "string",
///      "maxLength": 256,
///      "minLength": 1
///    },
///    "state": {
///      "oneOf": [
///        {
///          "type": "string",
///          "const": "pending"
///        },
///        {
///          "type": "string",
///          "const": "failed"
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
pub struct StartOfficialProviderLoginResponseStatusPendingLogin {
    pub error: ::std::option::Option<::std::string::String>,
    #[serde(rename = "loginId")]
    pub login_id: StartOfficialProviderLoginResponseStatusPendingLoginLoginId,
    pub state: StartOfficialProviderLoginResponseStatusPendingLoginState,
}
///`StartOfficialProviderLoginResponseStatusPendingLoginLoginId`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 256,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct StartOfficialProviderLoginResponseStatusPendingLoginLoginId(::std::string::String);
impl ::std::ops::Deref for StartOfficialProviderLoginResponseStatusPendingLoginLoginId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<StartOfficialProviderLoginResponseStatusPendingLoginLoginId>
    for ::std::string::String
{
    fn from(value: StartOfficialProviderLoginResponseStatusPendingLoginLoginId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for StartOfficialProviderLoginResponseStatusPendingLoginLoginId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 256usize {
            return Err("longer than 256 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for StartOfficialProviderLoginResponseStatusPendingLoginLoginId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for StartOfficialProviderLoginResponseStatusPendingLoginLoginId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for StartOfficialProviderLoginResponseStatusPendingLoginLoginId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for StartOfficialProviderLoginResponseStatusPendingLoginLoginId
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
///`StartOfficialProviderLoginResponseStatusPendingLoginState`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "string",
///      "const": "pending"
///    },
///    {
///      "type": "string",
///      "const": "failed"
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
pub enum StartOfficialProviderLoginResponseStatusPendingLoginState {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "failed")]
    Failed,
}
impl ::std::fmt::Display for StartOfficialProviderLoginResponseStatusPendingLoginState {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Pending => f.write_str("pending"),
            Self::Failed => f.write_str("failed"),
        }
    }
}
impl ::std::str::FromStr for StartOfficialProviderLoginResponseStatusPendingLoginState {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "pending" => Ok(Self::Pending),
            "failed" => Ok(Self::Failed),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for StartOfficialProviderLoginResponseStatusPendingLoginState {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for StartOfficialProviderLoginResponseStatusPendingLoginState
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for StartOfficialProviderLoginResponseStatusPendingLoginState
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`StartOfficialProviderLoginResponseStatusState`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "string",
///      "const": "disconnected"
///    },
///    {
///      "type": "string",
///      "const": "pending"
///    },
///    {
///      "type": "string",
///      "const": "connected"
///    },
///    {
///      "type": "string",
///      "const": "failed"
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
pub enum StartOfficialProviderLoginResponseStatusState {
    #[serde(rename = "disconnected")]
    Disconnected,
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "connected")]
    Connected,
    #[serde(rename = "failed")]
    Failed,
}
impl ::std::fmt::Display for StartOfficialProviderLoginResponseStatusState {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Disconnected => f.write_str("disconnected"),
            Self::Pending => f.write_str("pending"),
            Self::Connected => f.write_str("connected"),
            Self::Failed => f.write_str("failed"),
        }
    }
}
impl ::std::str::FromStr for StartOfficialProviderLoginResponseStatusState {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "disconnected" => Ok(Self::Disconnected),
            "pending" => Ok(Self::Pending),
            "connected" => Ok(Self::Connected),
            "failed" => Ok(Self::Failed),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for StartOfficialProviderLoginResponseStatusState {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for StartOfficialProviderLoginResponseStatusState
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for StartOfficialProviderLoginResponseStatusState
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
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
