//! SQLite、Git、文件系统与附件平台端口实现边界。

mod attachment_open;
mod attachment_validation;
mod attachments;
mod database;
mod files;
mod git;
mod host_file_browser;
mod migrations;
mod path_policy;
mod process;
mod project_file_index;
mod project_file_index_cache;
mod project_open;
mod project_tree;
mod repository;

pub use attachments::{AttachmentContent, AttachmentKind, AttachmentStore, AttachmentUpload};
pub use database::{DatabaseDiagnostics, DatabaseOptions, PlatformDatabase, PlatformError};
pub use files::{ImageFile, PlatformFilePort, PlatformFileService, SourceFilePage};
pub use git::GitCliService;
pub use host_file_browser::filesystem_roots;
pub use path_policy::CanonicalPathPolicy;
pub use repository::SqliteRepository;
