use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::domain::runtime::AgentEvent;

const MAX_TASK_ACTIVITIES: usize = 256;
const MAX_TASK_METADATA: usize = 2_048;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskActivityStatus {
    Completed,
    Failed,
    Running,
    Waiting,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskActivitySnapshot {
    pub(super) project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) root_path: Option<String>,
    pub(super) status: TaskActivityStatus,
    pub(super) task_id: String,
    pub(super) task_name: String,
}

#[derive(Clone, Debug)]
struct TaskMetadata {
    project_id: String,
    root_path: Option<String>,
    task_name: String,
}

#[derive(Clone, Debug)]
struct TaskActivityRecord {
    pending_request_ids: HashSet<String>,
    snapshot: TaskActivitySnapshot,
}

#[derive(Debug, Default)]
pub(super) struct TaskActivityState {
    activities: Vec<TaskActivityRecord>,
    metadata: HashMap<String, TaskMetadata>,
    project_roots: HashMap<String, String>,
}

impl TaskActivityState {
    pub(super) fn acknowledge(&mut self, project_id: &str, task_id: &str) -> bool {
        let Some(index) = self.activity_index(project_id, task_id) else {
            return false;
        };
        if matches!(
            self.activities[index].snapshot.status,
            TaskActivityStatus::Running | TaskActivityStatus::Waiting
        ) {
            return false;
        }
        self.activities.remove(index);
        true
    }

    pub(super) fn fail_active(&mut self) -> bool {
        let mut changed = false;
        for record in &mut self.activities {
            if matches!(
                record.snapshot.status,
                TaskActivityStatus::Running | TaskActivityStatus::Waiting
            ) {
                record.snapshot.status = TaskActivityStatus::Failed;
                record.pending_request_ids.clear();
                changed = true;
            }
        }
        changed
    }

    pub(super) fn apply_event(&mut self, project_id: &str, event: &AgentEvent) -> bool {
        let Some(task_id) = event.task_id() else {
            return false;
        };
        match event.event_type() {
            Some("task.metadata_changed") => {
                let title = event
                    .as_json()
                    .and_then(|event| event.pointer("/payload/title"))
                    .and_then(serde_json::Value::as_str);
                self.update_title(project_id, task_id, title)
            }
            Some("task.removed") => self.remove_task(project_id, task_id),
            Some("turn.started") => {
                let inserted = self.activity_index(project_id, task_id).is_none();
                let record = self.ensure_activity(project_id, task_id);
                let changed = inserted
                    || record.snapshot.status != TaskActivityStatus::Running
                    || !record.pending_request_ids.is_empty();
                record.snapshot.status = TaskActivityStatus::Running;
                record.pending_request_ids.clear();
                changed
            }
            Some("pending_request.created") => {
                let request_id = event
                    .as_json()
                    .and_then(|event| event.pointer("/payload/request/requestId"))
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned);
                let record = self.ensure_activity(project_id, task_id);
                let mut changed = record.snapshot.status != TaskActivityStatus::Waiting;
                record.snapshot.status = TaskActivityStatus::Waiting;
                if let Some(request_id) = request_id {
                    changed |= record.pending_request_ids.insert(request_id);
                }
                changed
            }
            Some("pending_request.resolved" | "pending_request.expired") => {
                let request_id = event
                    .as_json()
                    .and_then(|event| event.pointer("/payload/request/requestId"))
                    .and_then(serde_json::Value::as_str);
                let Some(index) = self.activity_index(project_id, task_id) else {
                    return false;
                };
                let record = &mut self.activities[index];
                let removed = request_id.is_some_and(|id| record.pending_request_ids.remove(id));
                if record.pending_request_ids.is_empty()
                    && record.snapshot.status == TaskActivityStatus::Waiting
                {
                    record.snapshot.status = TaskActivityStatus::Running;
                    return true;
                }
                removed
            }
            Some("turn.completed") => {
                let failed = event
                    .as_json()
                    .and_then(|event| event.pointer("/payload/turn/status"))
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|status| matches!(status, "failed" | "interrupted"));
                self.set_terminal_status(project_id, task_id, failed)
            }
            Some("provider.error")
                if event
                    .as_json()
                    .and_then(|event| event.pointer("/payload/willRetry"))
                    .and_then(serde_json::Value::as_bool)
                    == Some(false) =>
            {
                self.set_terminal_status(project_id, task_id, true)
            }
            Some("task.status_updated") => match event
                .as_json()
                .and_then(|event| event.pointer("/payload/status"))
                .and_then(serde_json::Value::as_str)
            {
                Some("running") => {
                    let inserted = self.activity_index(project_id, task_id).is_none();
                    let record = self.ensure_activity(project_id, task_id);
                    let changed = inserted || record.snapshot.status != TaskActivityStatus::Running;
                    record.snapshot.status = TaskActivityStatus::Running;
                    changed
                }
                Some("failed") => self.set_terminal_status(project_id, task_id, true),
                _ => false,
            },
            _ => false,
        }
    }

    pub(super) fn remember_project_root(&mut self, project_id: &str, root_path: Option<&str>) {
        let Some(root_path) = normalized(root_path) else {
            return;
        };
        self.project_roots
            .insert(project_id.to_owned(), root_path.to_owned());
        for metadata in self
            .metadata
            .values_mut()
            .filter(|metadata| metadata.project_id == project_id)
        {
            metadata.root_path = Some(root_path.to_owned());
        }
        for record in self
            .activities
            .iter_mut()
            .filter(|record| record.snapshot.project_id == project_id)
        {
            record.snapshot.root_path = Some(root_path.to_owned());
        }
    }

    pub(super) fn forget_project(&mut self, project_id: &str) {
        self.project_roots.remove(project_id);
        self.metadata
            .retain(|_, metadata| metadata.project_id != project_id);
        self.activities
            .retain(|record| record.snapshot.project_id != project_id);
    }

    pub(super) fn remember_task(
        &mut self,
        project_id: &str,
        task_id: &str,
        task_name: &str,
        root_path: Option<&str>,
    ) {
        if !self.metadata.contains_key(task_id) && self.metadata.len() >= MAX_TASK_METADATA {
            self.evict_inactive_metadata();
        }
        let root_path = normalized(root_path)
            .map(str::to_owned)
            .or_else(|| self.project_roots.get(project_id).cloned());
        let task_name = normalized(Some(task_name)).unwrap_or(task_id).to_owned();
        self.metadata.insert(
            task_id.to_owned(),
            TaskMetadata {
                project_id: project_id.to_owned(),
                root_path: root_path.clone(),
                task_name: task_name.clone(),
            },
        );
        if let Some(index) = self.activity_index(project_id, task_id) {
            let snapshot = &mut self.activities[index].snapshot;
            snapshot.root_path = root_path;
            snapshot.task_name = task_name;
        }
    }

    pub(super) fn remember_task_snapshot(
        &mut self,
        project_id: &str,
        task_id: &str,
        task_name: &str,
        status: &str,
        pending_request_ids: Vec<String>,
    ) {
        self.remember_task(project_id, task_id, task_name, None);
        if !pending_request_ids.is_empty() {
            let record = self.ensure_activity(project_id, task_id);
            record.snapshot.status = TaskActivityStatus::Waiting;
            record.pending_request_ids = pending_request_ids.into_iter().collect();
            return;
        }
        match status {
            "running" => {
                let record = self.ensure_activity(project_id, task_id);
                record.snapshot.status = TaskActivityStatus::Running;
                record.pending_request_ids.clear();
            }
            "failed" => {
                self.set_terminal_status(project_id, task_id, true);
            }
            _ => {
                // 普通空闲任务不创建活动；已有运行记录必须由权威快照收敛为完成。
                if let Some(index) = self.activity_index(project_id, task_id) {
                    let record = &mut self.activities[index];
                    record.snapshot.status = TaskActivityStatus::Completed;
                    record.pending_request_ids.clear();
                }
            }
        }
    }

    pub(super) fn snapshot(&self) -> Vec<TaskActivitySnapshot> {
        self.activities
            .iter()
            .map(|record| record.snapshot.clone())
            .collect()
    }

    pub(super) fn task_name(&self, task_id: &str) -> Option<&str> {
        self.metadata
            .get(task_id)
            .map(|metadata| metadata.task_name.as_str())
    }

    fn activity_index(&self, project_id: &str, task_id: &str) -> Option<usize> {
        self.activities.iter().position(|record| {
            record.snapshot.project_id == project_id && record.snapshot.task_id == task_id
        })
    }

    fn ensure_activity(&mut self, project_id: &str, task_id: &str) -> &mut TaskActivityRecord {
        if let Some(index) = self.activity_index(project_id, task_id) {
            return &mut self.activities[index];
        }
        if self.activities.len() >= MAX_TASK_ACTIVITIES {
            let terminal_index = self
                .activities
                .iter()
                .position(|record| {
                    matches!(
                        record.snapshot.status,
                        TaskActivityStatus::Completed | TaskActivityStatus::Failed
                    )
                })
                .unwrap_or(0);
            self.activities.remove(terminal_index);
        }
        let metadata = self.metadata.get(task_id);
        self.activities.push(TaskActivityRecord {
            pending_request_ids: HashSet::new(),
            snapshot: TaskActivitySnapshot {
                project_id: project_id.to_owned(),
                root_path: metadata.and_then(|metadata| metadata.root_path.clone()),
                status: TaskActivityStatus::Running,
                task_id: task_id.to_owned(),
                task_name: metadata
                    .map(|metadata| metadata.task_name.clone())
                    .unwrap_or_else(|| task_id.to_owned()),
            },
        });
        self.activities
            .last_mut()
            .expect("activity was just inserted")
    }

    fn evict_inactive_metadata(&mut self) {
        let active_ids = self
            .activities
            .iter()
            .map(|record| record.snapshot.task_id.as_str())
            .collect::<HashSet<_>>();
        let candidate = self
            .metadata
            .keys()
            .find(|task_id| !active_ids.contains(task_id.as_str()))
            .cloned();
        if let Some(task_id) = candidate {
            self.metadata.remove(&task_id);
        }
    }

    fn remove_task(&mut self, project_id: &str, task_id: &str) -> bool {
        let metadata_removed = self
            .metadata
            .remove(task_id)
            .is_some_and(|metadata| metadata.project_id == project_id);
        let original_len = self.activities.len();
        self.activities.retain(|record| {
            record.snapshot.project_id != project_id || record.snapshot.task_id != task_id
        });
        metadata_removed || self.activities.len() != original_len
    }

    fn set_terminal_status(&mut self, project_id: &str, task_id: &str, failed: bool) -> bool {
        let status = if failed {
            TaskActivityStatus::Failed
        } else {
            TaskActivityStatus::Completed
        };
        let record = self.ensure_activity(project_id, task_id);
        let changed = record.snapshot.status != status || !record.pending_request_ids.is_empty();
        record.snapshot.status = status;
        record.pending_request_ids.clear();
        changed
    }

    fn update_title(&mut self, project_id: &str, task_id: &str, task_name: Option<&str>) -> bool {
        let Some(task_name) = normalized(task_name) else {
            return false;
        };
        let root_path = self
            .metadata
            .get(task_id)
            .and_then(|metadata| metadata.root_path.as_deref())
            .map(str::to_owned);
        self.remember_task(project_id, task_id, task_name, root_path.as_deref());
        true
    }
}

fn normalized(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}
