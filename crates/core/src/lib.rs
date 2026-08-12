//! CodeAgent 宿主无关领域模型与端口。

mod error;
mod ports;

pub use error::{CodeAgentError, CodeAgentErrorCode};
pub use ports::{
    AttachmentPort, ClockPort, FilePort, GitPort, PortRequestContext, ProjectRepositoryPort,
    ProviderPort, RepositoryPort, UpdatePort,
};
