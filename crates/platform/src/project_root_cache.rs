use std::collections::HashMap;
use std::sync::Arc;

use rusqlite::OptionalExtension;
use tokio::sync::Mutex;

use crate::{CanonicalPathPolicy, PlatformDatabase, PlatformError};

#[derive(Clone, Debug)]
pub struct ProjectRootCache {
    inner: Arc<Mutex<HashMap<Box<str>, CanonicalPathPolicy>>>,
}

impl ProjectRootCache {
    #[must_use]
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub(crate) async fn policy_for(
        &self,
        database: &PlatformDatabase,
        project_id: &str,
    ) -> Result<CanonicalPathPolicy, PlatformError> {
        let mut cache = self.inner.lock().await;
        if let Some(policy) = cache.get(project_id) {
            return Ok(policy.clone());
        }
        let project_id = project_id.to_owned();
        let lookup_id = project_id.clone();
        let root = database
            .call(move |connection| {
                connection
                    .query_row(
                        "SELECT root_path FROM projects WHERE id = ?1",
                        [lookup_id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?
                    .ok_or_else(|| PlatformError::Worker("project not found".to_owned()))
            })
            .await?;
        let policy = CanonicalPathPolicy::new(root).await?;
        cache.insert(project_id.into_boxed_str(), policy.clone());
        Ok(policy)
    }

    pub(crate) async fn invalidate(&self, project_id: &str) {
        self.inner.lock().await.remove(project_id);
    }

    pub(crate) async fn clear(&self) {
        self.inner.lock().await.clear();
    }

    #[cfg(test)]
    async fn contains(&self, project_id: &str) -> bool {
        self.inner.lock().await.contains_key(project_id)
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, time::Duration};

    use chrono::{TimeZone, Utc};
    use code_agent_core::{PortRequestContext, RepositoryPort};

    use super::*;
    use crate::{DatabaseOptions, SqliteRepository};

    #[tokio::test]
    async fn cache_should_reuse_policy_until_invalidated() {
        let root = std::env::temp_dir().join(format!("code-agent-root-cache-{}", std::process::id()));
        let database_path = root.join("state.sqlite3");
        let project_root = root.join("repository");
        fs::create_dir_all(&project_root).expect("project root");
        let database = PlatformDatabase::open(DatabaseOptions {
            path: database_path,
            queue_capacity: 4,
            request_timeout: Duration::from_secs(2),
        })
        .await
        .expect("database");
        let cache = ProjectRootCache::new();
        let repository = SqliteRepository::with_root_cache(database.clone(), cache.clone());
        let project = repository
            .register_project(
                &project_root.to_string_lossy(),
                "Cache",
                Utc.with_ymd_and_hms(2026, 8, 16, 0, 0, 0)
                    .single()
                    .expect("timestamp"),
                &PortRequestContext::new("register"),
            )
            .await
            .expect("project");
        let project_id = project.id.to_string();
        let policy = cache
            .policy_for(&database, &project_id)
            .await
            .expect("first load");
        assert!(cache.contains(&project_id).await);
        let cached = cache
            .policy_for(&database, &project_id)
            .await
            .expect("cached load");
        assert_eq!(policy.root(), cached.root());
        cache.invalidate(&project_id).await;
        assert!(!cache.contains(&project_id).await);
        let reloaded = cache
            .policy_for(&database, &project_id)
            .await
            .expect("reload after invalidate");
        assert_eq!(policy.root(), reloaded.root());
        repository
            .remove_project(&project.id, &PortRequestContext::new("remove"))
            .await
            .expect("remove");
        assert!(
            cache.policy_for(&database, &project_id).await.is_err(),
            "removed project must not resolve"
        );
        fs::remove_dir_all(root).expect("cleanup");
    }
}
