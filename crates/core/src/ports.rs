use std::sync::Arc;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use code_agent_protocol::{
    AgentAttachment, AgentAttachmentKind, AgentBackgroundTerminalPage, AgentCapabilities,
    AgentGlobalSettings, AgentMcpServerPage, AgentModelPage, AgentProjectDefaults,
    AgentProviderConnectionRecord, AgentSkillPage, AgentTaskPage, AgentTaskSettings, Project,
    ProjectId, RawProviderEvent, TaskId,
};
use serde_json::Value;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::CodeAgentError;

/// 附件正文所有权；内联历史附件可共享底层只读分配，文件读取则直接转移所有权。
#[derive(Clone, Debug)]
pub enum AttachmentBytes {
    Owned(Vec<u8>),
    Shared(Arc<[u8]>),
}

impl PartialEq for AttachmentBytes {
    fn eq(&self, other: &Self) -> bool {
        self.as_slice() == other.as_slice()
    }
}

impl Eq for AttachmentBytes {}

impl AsRef<[u8]> for AttachmentBytes {
    fn as_ref(&self) -> &[u8] {
        self.as_slice()
    }
}

impl From<Vec<u8>> for AttachmentBytes {
    fn from(bytes: Vec<u8>) -> Self {
        Self::Owned(bytes)
    }
}

impl AttachmentBytes {
    /// 返回附件字节切片。
    #[must_use]
    pub fn as_slice(&self) -> &[u8] {
        match self {
            Self::Owned(bytes) => bytes,
            Self::Shared(bytes) => bytes,
        }
    }

    /// 转为独占缓冲区；共享内容仅在宿主边界确实要求时复制一次。
    #[must_use]
    pub fn into_vec(self) -> Vec<u8> {
        match self {
            Self::Owned(bytes) => bytes,
            Self::Shared(bytes) => bytes.as_ref().to_vec(),
        }
    }
}

/// 已通过附件 Store 归属校验的受管文件。
#[derive(Clone, Debug)]
pub struct ManagedAttachment {
    pub attachment: AgentAttachment,
    pub path: String,
}

/// 单次领域操作的身份与协作取消上下文。
#[derive(Clone, Debug)]
pub struct PortRequestContext {
    cancellation: CancellationToken,
    request_id: Arc<str>,
}

impl PortRequestContext {
    /// 创建请求上下文。
    #[must_use]
    pub fn new(request_id: impl Into<Arc<str>>) -> Self {
        Self {
            cancellation: CancellationToken::new(),
            request_id: request_id.into(),
        }
    }

    /// 返回请求 ID。
    #[must_use]
    pub fn request_id(&self) -> &str {
        &self.request_id
    }

    /// 通知所有共享上下文的操作协作取消。
    pub fn cancel(&self) {
        self.cancellation.cancel();
    }

    /// 返回请求是否已取消。
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.cancellation.is_cancelled()
    }

    /// 等待取消通知。
    pub async fn cancelled(&self) {
        self.cancellation.cancelled().await;
    }
}

/// Project 与设置持久化端口。
#[async_trait]
pub trait RepositoryPort: Send + Sync {
    /// 关闭持久化 owner 与命令队列。
    async fn close(&self) -> Result<(), CodeAgentError> {
        Ok(())
    }

    /// 读取已注册 Project；不存在时返回 `None`。
    async fn read_project(
        &self,
        project_id: &ProjectId,
        context: &PortRequestContext,
    ) -> Result<Option<Value>, CodeAgentError>;

    /// 返回全部用户 Project，排除临时 Project。
    async fn list_projects(
        &self,
        _context: &PortRequestContext,
    ) -> Result<Vec<Project>, CodeAgentError> {
        Err(CodeAgentError::internal(
            "project repository is unavailable",
        ))
    }

    /// 注册用户 Project；同一路径重复注册返回既有记录。
    async fn register_project(
        &self,
        _root_path: &str,
        _name: &str,
        _created_at: DateTime<Utc>,
        _context: &PortRequestContext,
    ) -> Result<Project, CodeAgentError> {
        Err(CodeAgentError::internal(
            "project repository is unavailable",
        ))
    }

    /// 确保临时 Project 存在且不进入用户列表。
    async fn ensure_temporary_project(
        &self,
        _root_path: &str,
        _created_at: DateTime<Utc>,
        _context: &PortRequestContext,
    ) -> Result<Project, CodeAgentError> {
        Err(CodeAgentError::internal(
            "project repository is unavailable",
        ))
    }

    /// 原子替换全部用户 Project 顺序。
    async fn reorder_projects(
        &self,
        _project_ids: &[ProjectId],
        _context: &PortRequestContext,
    ) -> Result<Vec<Project>, CodeAgentError> {
        Err(CodeAgentError::internal(
            "project repository is unavailable",
        ))
    }

    /// 重命名用户 Project。
    async fn rename_project(
        &self,
        _project_id: &ProjectId,
        _name: &str,
        _context: &PortRequestContext,
    ) -> Result<Project, CodeAgentError> {
        Err(CodeAgentError::internal(
            "project repository is unavailable",
        ))
    }

    /// 删除用户 Project 的本地注册信息。
    async fn remove_project(
        &self,
        _project_id: &ProjectId,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        Err(CodeAgentError::internal(
            "project repository is unavailable",
        ))
    }

    /// 读取全局设置。
    async fn read_global_settings(
        &self,
        _context: &PortRequestContext,
    ) -> Result<Option<AgentGlobalSettings>, CodeAgentError> {
        Err(CodeAgentError::internal(
            "settings repository is unavailable",
        ))
    }

    /// 原子写入完整全局设置。
    async fn write_global_settings(
        &self,
        _settings: &AgentGlobalSettings,
        _updated_at: DateTime<Utc>,
        _context: &PortRequestContext,
    ) -> Result<AgentGlobalSettings, CodeAgentError> {
        Err(CodeAgentError::internal(
            "settings repository is unavailable",
        ))
    }

    /// 读取 Project 默认设置。
    async fn read_project_defaults(
        &self,
        _project_id: &ProjectId,
        _context: &PortRequestContext,
    ) -> Result<Option<AgentProjectDefaults>, CodeAgentError> {
        Err(CodeAgentError::internal(
            "settings repository is unavailable",
        ))
    }

    /// 原子写入 Project 默认设置。
    async fn write_project_defaults(
        &self,
        _project_id: &ProjectId,
        _settings: &AgentProjectDefaults,
        _updated_at: DateTime<Utc>,
        _context: &PortRequestContext,
    ) -> Result<AgentProjectDefaults, CodeAgentError> {
        Err(CodeAgentError::internal(
            "settings repository is unavailable",
        ))
    }

    /// 读取 Task 设置。
    async fn read_task_settings(
        &self,
        _project_id: &ProjectId,
        _task_id: &TaskId,
        _context: &PortRequestContext,
    ) -> Result<Option<AgentTaskSettings>, CodeAgentError> {
        Err(CodeAgentError::internal(
            "settings repository is unavailable",
        ))
    }

    /// 原子写入 Task 设置。
    async fn write_task_settings(
        &self,
        _project_id: &ProjectId,
        _task_id: &TaskId,
        _settings: &AgentTaskSettings,
        _updated_at: DateTime<Utc>,
        _context: &PortRequestContext,
    ) -> Result<AgentTaskSettings, CodeAgentError> {
        Err(CodeAgentError::internal(
            "settings repository is unavailable",
        ))
    }

    /// 读取 Provider connection 持久化记录。
    async fn read_provider_connection(
        &self,
        _context: &PortRequestContext,
    ) -> Result<Option<AgentProviderConnectionRecord>, CodeAgentError> {
        Err(CodeAgentError::internal(
            "provider connection repository is unavailable",
        ))
    }

    /// 原子写入 Provider connection 持久化记录。
    async fn write_provider_connection(
        &self,
        _record: &AgentProviderConnectionRecord,
        _context: &PortRequestContext,
    ) -> Result<AgentProviderConnectionRecord, CodeAgentError> {
        Err(CodeAgentError::internal(
            "provider connection repository is unavailable",
        ))
    }
}

/// 标记实现完整 Project registry 能力的 Repository。
pub trait ProjectRepositoryPort: RepositoryPort {}

impl<T: RepositoryPort + ?Sized> ProjectRepositoryPort for T {}

/// Provider 领域能力端口。
#[async_trait]
pub trait ProviderPort: Send + Sync {
    /// 读取当前 Provider 能力。
    async fn capabilities(
        &self,
        context: &PortRequestContext,
    ) -> Result<AgentCapabilities, CodeAgentError>;

    /// 读取全局模型目录。
    async fn models(
        &self,
        _context: &PortRequestContext,
    ) -> Result<AgentModelPage, CodeAgentError> {
        Err(CodeAgentError::internal(
            "provider model catalog is unavailable",
        ))
    }

    /// 读取 Provider 默认设置。
    async fn default_settings(
        &self,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Err(CodeAgentError::internal(
            "provider defaults are unavailable",
        ))
    }

    /// 读取 Provider 连接状态。
    async fn connection_status(
        &self,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Err(CodeAgentError::internal(
            "provider connection is unavailable",
        ))
    }

    /// 启动官方 Provider 登录。
    async fn start_official_login(
        &self,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Err(CodeAgentError::internal("provider login is unavailable"))
    }

    /// 取消官方 Provider 登录。
    async fn cancel_login(
        &self,
        _login_id: &str,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Err(CodeAgentError::internal("provider login is unavailable"))
    }

    /// 登出当前 Provider。
    async fn logout(&self, _context: &PortRequestContext) -> Result<Value, CodeAgentError> {
        Err(CodeAgentError::internal("provider logout is unavailable"))
    }

    /// 配置自定义 Provider；敏感字段不得进入持久化或返回值。
    async fn configure_custom(
        &self,
        _input: Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Err(CodeAgentError::internal("custom provider is unavailable"))
    }

    /// 创建或复用 Project 作用域 Provider。
    async fn for_project(
        &self,
        _project: Project,
        _context: &PortRequestContext,
    ) -> Result<Arc<dyn ProjectProviderPort>, CodeAgentError> {
        Err(CodeAgentError::internal("project provider is unavailable"))
    }

    /// 释放 Project 作用域 Provider 与全部路由状态。
    async fn release_project(
        &self,
        _project_id: &ProjectId,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        Ok(())
    }
}

/// Project 作用域的任务、回合与实时能力端口。
#[async_trait]
pub trait ProjectProviderPort: Send + Sync {
    async fn start_task(
        &self,
        input: Value,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError>;
    async fn list_tasks(
        &self,
        input: Value,
        context: &PortRequestContext,
    ) -> Result<AgentTaskPage, CodeAgentError>;
    async fn read_task(
        &self,
        task_id: &str,
        context: &PortRequestContext,
    ) -> Result<Option<Value>, CodeAgentError>;
    /// 读取 Provider 历史快照授权的附件字节。
    async fn read_task_attachment(
        &self,
        _task_id: &str,
        _attachment_id: &str,
        _context: &PortRequestContext,
    ) -> Result<Option<AttachmentBytes>, CodeAgentError> {
        Ok(None)
    }
    async fn pin_task(
        &self,
        task_id: &str,
        pinned: bool,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError>;
    async fn rename_task(
        &self,
        task_id: &str,
        title: &str,
        context: &PortRequestContext,
    ) -> Result<(), CodeAgentError>;
    async fn archive_task(
        &self,
        task_id: &str,
        context: &PortRequestContext,
    ) -> Result<(), CodeAgentError>;
    async fn fork_task(
        &self,
        task_id: &str,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError>;
    async fn compact_task(
        &self,
        task_id: &str,
        context: &PortRequestContext,
    ) -> Result<(), CodeAgentError>;
    async fn unsubscribe_task(
        &self,
        task_id: &str,
        context: &PortRequestContext,
    ) -> Result<String, CodeAgentError>;
    async fn start_turn(
        &self,
        task_id: &str,
        input: Value,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError>;
    async fn steer_turn(
        &self,
        task_id: &str,
        turn_id: &str,
        input: Value,
        context: &PortRequestContext,
    ) -> Result<(), CodeAgentError>;
    async fn interrupt_turn(
        &self,
        task_id: &str,
        turn_id: &str,
        context: &PortRequestContext,
    ) -> Result<(), CodeAgentError>;
    async fn start_review(
        &self,
        task_id: &str,
        target: Value,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError>;
    async fn resolve_pending_request(
        &self,
        input: Value,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError>;
    async fn list_skills(
        &self,
        context: &PortRequestContext,
    ) -> Result<AgentSkillPage, CodeAgentError>;
    async fn list_mcp_servers(
        &self,
        task_id: &str,
        context: &PortRequestContext,
    ) -> Result<AgentMcpServerPage, CodeAgentError>;
    async fn reload_mcp_servers(
        &self,
        task_id: &str,
        context: &PortRequestContext,
    ) -> Result<AgentMcpServerPage, CodeAgentError>;
    async fn list_background_terminals(
        &self,
        task_id: &str,
        context: &PortRequestContext,
    ) -> Result<AgentBackgroundTerminalPage, CodeAgentError>;
    async fn terminate_background_terminal(
        &self,
        task_id: &str,
        terminal_id: &str,
        context: &PortRequestContext,
    ) -> Result<bool, CodeAgentError>;
    async fn upload_feedback(
        &self,
        task_id: &str,
        input: Value,
        context: &PortRequestContext,
    ) -> Result<(), CodeAgentError>;
    async fn subscribe_events(
        &self,
        include_ephemeral: bool,
        context: &PortRequestContext,
    ) -> Result<mpsc::Receiver<RawProviderEvent>, CodeAgentError>;
}

/// Git 宿主能力端口。
#[async_trait]
pub trait GitPort: Send + Sync {
    /// 读取 Project Git 状态。
    async fn status(
        &self,
        project_id: &ProjectId,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError>;

    /// 按可选直属子仓库读取状态。
    async fn status_for(
        &self,
        project_id: &ProjectId,
        _repository: Option<&str>,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.status(project_id, context).await
    }

    /// 读取提交历史。
    async fn history(
        &self,
        _project_id: &ProjectId,
        _query: &Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Err(CodeAgentError::internal("git service is unavailable"))
    }

    /// 读取提交文件列表。
    async fn commit_files(
        &self,
        _project_id: &ProjectId,
        _query: &Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Err(CodeAgentError::internal("git service is unavailable"))
    }

    /// 读取提交文件 diff。
    async fn commit_diff(
        &self,
        _project_id: &ProjectId,
        _query: &Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Err(CodeAgentError::internal("git service is unavailable"))
    }

    /// 切换分支。
    async fn switch_branch(
        &self,
        _project_id: &ProjectId,
        _branch: &str,
        _expected_snapshot: &str,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Err(CodeAgentError::internal("git service is unavailable"))
    }

    /// 创建并切换分支。
    async fn create_branch(
        &self,
        _project_id: &ProjectId,
        _branch: &str,
        _expected_snapshot: &str,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Err(CodeAgentError::internal("git service is unavailable"))
    }

    /// 提交选定文件。
    async fn commit(
        &self,
        _project_id: &ProjectId,
        _request: &Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Err(CodeAgentError::internal("git service is unavailable"))
    }
}

/// Project 文件能力端口。
#[async_trait]
pub trait FilePort: Send + Sync {
    /// 释放指定 Project 的文件索引与进行中遍历。
    async fn release_project(
        &self,
        _project_id: &ProjectId,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        Ok(())
    }

    /// 关闭全部文件索引与进行中遍历。
    async fn close(&self) -> Result<(), CodeAgentError> {
        Ok(())
    }

    /// 读取受 Project 范围约束的文件字节。
    async fn read(
        &self,
        project_id: &ProjectId,
        path: &str,
        context: &PortRequestContext,
    ) -> Result<Vec<u8>, CodeAgentError>;

    /// 读取 Project 源文件分页。
    async fn source_read(
        &self,
        _project_id: &ProjectId,
        _path: &str,
        _cursor: u64,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Err(CodeAgentError::internal("file service is unavailable"))
    }

    /// 读取 Project 文件树。
    async fn tree(
        &self,
        _project_id: &ProjectId,
        _path: Option<&str>,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Err(CodeAgentError::internal("file service is unavailable"))
    }

    /// 搜索 Project 文件。
    async fn search(
        &self,
        _project_id: &ProjectId,
        _query: &str,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Err(CodeAgentError::internal("file service is unavailable"))
    }

    /// 浏览宿主目录。
    async fn browse_directories(
        &self,
        _path: Option<&str>,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Err(CodeAgentError::internal("directory browser is unavailable"))
    }

    /// 浏览宿主支持的普通文件。
    async fn browse_host_files(
        &self,
        _kind: &str,
        _path: Option<&str>,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Err(CodeAgentError::internal("host file browser is unavailable"))
    }

    /// 返回当前平台可用打开方式。
    async fn open_capabilities(
        &self,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Err(CodeAgentError::internal("system open is unavailable"))
    }

    /// 使用受控宿主应用打开 Project 路径。
    async fn open_project_path(
        &self,
        _project_id: &ProjectId,
        _app_id: &str,
        _path: Option<&str>,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Err(CodeAgentError::internal("system open is unavailable"))
    }
}

/// Task 附件能力端口。
#[async_trait]
pub trait AttachmentPort: Send + Sync {
    /// 保存 Renderer 通过 raw IPC 上传的附件字节。
    async fn upload(
        &self,
        _project_id: &ProjectId,
        _kind: AgentAttachmentKind,
        _media_type: &str,
        _name: &str,
        _bytes: Vec<u8>,
        _context: &PortRequestContext,
    ) -> Result<AgentAttachment, CodeAgentError> {
        Err(CodeAgentError::internal(
            "attachment service is unavailable",
        ))
    }

    /// 将受检宿主文件复制到附件受管目录。
    async fn import_host(
        &self,
        _project_id: &ProjectId,
        _kind: AgentAttachmentKind,
        _path: &str,
        _context: &PortRequestContext,
    ) -> Result<AgentAttachment, CodeAgentError> {
        Err(CodeAgentError::internal(
            "attachment service is unavailable",
        ))
    }

    /// 读取尚未绑定 Task 的 Project 附件。
    async fn read_pending(
        &self,
        _project_id: &ProjectId,
        _attachment_id: &str,
        _context: &PortRequestContext,
    ) -> Result<Vec<u8>, CodeAgentError> {
        Err(CodeAgentError::internal(
            "attachment service is unavailable",
        ))
    }

    /// 解析待提交附件，但不改变其生命周期状态。
    async fn resolve_pending(
        &self,
        _project_id: &ProjectId,
        _attachment_id: &str,
        _context: &PortRequestContext,
    ) -> Result<ManagedAttachment, CodeAgentError> {
        Err(CodeAgentError::internal(
            "attachment service is unavailable",
        ))
    }

    /// Provider 接受 Turn 后，将附件原子绑定到 Task/Turn。
    async fn bind_to_turn(
        &self,
        _project_id: &ProjectId,
        _task_id: &TaskId,
        _turn_id: &str,
        _attachment_ids: &[String],
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        Err(CodeAgentError::internal(
            "attachment service is unavailable",
        ))
    }

    /// Turn 终态后释放运行期附件副本。
    async fn release_turn(
        &self,
        _project_id: &ProjectId,
        _turn_id: &str,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        Ok(())
    }

    /// 读取已授权附件字节。
    async fn read(
        &self,
        project_id: &ProjectId,
        task_id: &TaskId,
        attachment_id: &str,
        context: &PortRequestContext,
    ) -> Result<Vec<u8>, CodeAgentError>;

    /// 清理 Project 受管附件。
    async fn release_project(
        &self,
        _project_id: &ProjectId,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        Err(CodeAgentError::internal(
            "attachment service is unavailable",
        ))
    }

    /// 使用系统默认应用打开已授权 Task 附件副本。
    async fn open(
        &self,
        _project_id: &ProjectId,
        _task_id: &TaskId,
        _attachment_id: &str,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        Err(CodeAgentError::internal(
            "attachment service is unavailable",
        ))
    }
}

/// 可替换时钟端口。
pub trait ClockPort: Send + Sync {
    /// 返回当前 UTC 时间。
    fn now(&self) -> DateTime<Utc>;
}

/// 应用更新能力端口。
#[async_trait]
pub trait UpdatePort: Send + Sync {
    /// 返回当前产品版本。
    async fn current_version(&self, context: &PortRequestContext)
    -> Result<String, CodeAgentError>;
}
