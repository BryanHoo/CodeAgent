//! SQLite、Git、文件系统与附件平台端口实现边界。

mod attachments;
mod database;
mod files;
mod git;
mod migrations;
mod path_policy;
mod process;
mod repository;

pub use attachments::{AttachmentContent, AttachmentKind, AttachmentStore, AttachmentUpload};
pub use database::{DatabaseDiagnostics, DatabaseOptions, PlatformDatabase, PlatformError};
pub use files::{ImageFile, PlatformFilePort, PlatformFileService, SourceFilePage};
pub use git::GitCliService;
pub use path_policy::CanonicalPathPolicy;
pub use repository::SqliteRepository;
