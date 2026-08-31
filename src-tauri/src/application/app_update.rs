use std::{sync::OnceLock, time::Duration};

use futures_util::StreamExt;
use reqwest::{Client, Response, header, redirect::Policy};
use semver::Version;
use serde::Deserialize;

pub(super) const CHANGELOG_URL: &str =
    "https://github.com/BryanHoo/CodeAgent/blob/main/CHANGELOG.md";
pub(super) const REPOSITORY_URL: &str = "https://github.com/BryanHoo/CodeAgent";

const INITIAL_VERSION: &str = "0.1.0";
const RELEASES_URL: &str = "https://api.github.com/repos/BryanHoo/CodeAgent/releases?per_page=1";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_RELEASE_NOTES_BYTES: usize = 32 * 1024;
const CHANGELOG: &str = include_str!("../../../CHANGELOG.md");
static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();

#[derive(Debug, PartialEq)]
pub(super) struct AppUpdate {
    pub(super) latest_version: Option<String>,
    pub(super) release_notes: String,
    pub(super) release_notes_version: String,
    pub(super) status: &'static str,
    pub(super) update_available: bool,
}

#[derive(Deserialize)]
struct GitHubRelease {
    body: Option<String>,
    tag_name: String,
}

pub(super) async fn check_for_update(current_version: &str) -> AppUpdate {
    let response = match fetch_releases().await {
        Ok(response) => response,
        Err(()) => return failed_update(current_version),
    };
    resolve_release_response(current_version, &response)
}

fn http_client() -> Result<&'static Client, ()> {
    if let Some(client) = HTTP_CLIENT.get() {
        return Ok(client);
    }
    let client = Client::builder()
        .connect_timeout(REQUEST_TIMEOUT)
        .redirect(Policy::none())
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|_| ())?;
    let _ = HTTP_CLIENT.set(client);
    HTTP_CLIENT.get().ok_or(())
}

async fn fetch_releases() -> Result<Vec<u8>, ()> {
    // 更新检查只允许访问固定 GitHub API，并限制超时与响应体，避免拖慢应用启动。
    let response = http_client()?
        .get(RELEASES_URL)
        .header(header::ACCEPT, "application/vnd.github+json")
        .header(header::USER_AGENT, "CodeAgent-update-check")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|_| ())?;
    if !is_valid_response(&response) {
        return Err(());
    }
    read_bounded_body(response).await
}

fn is_valid_response(response: &Response) -> bool {
    response.status().is_success()
        && response.url().as_str() == RELEASES_URL
        && response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.to_ascii_lowercase().starts_with("application/json"))
}

async fn read_bounded_body(response: Response) -> Result<Vec<u8>, ()> {
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| ())?;
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn resolve_release_response(current_version: &str, body: &[u8]) -> AppUpdate {
    let current = match Version::parse(current_version) {
        Ok(version) => version,
        Err(_) => return failed_update(current_version),
    };
    let releases = match serde_json::from_slice::<Vec<GitHubRelease>>(body) {
        Ok(releases) => releases,
        Err(_) => return failed_update(current_version),
    };
    let Some(release) = releases.first() else {
        // 0.1.0 发布前允许仓库尚无公开 release；后续版本缺失 release 必须显式报错。
        return if current_version == INITIAL_VERSION {
            current_update(current_version, None)
        } else {
            failed_update(current_version)
        };
    };
    let latest_version = match release
        .tag_name
        .strip_prefix('v')
        .and_then(|value| Version::parse(value).ok())
    {
        Some(version) => version,
        None => return failed_update(current_version),
    };
    let Some(notes) = release
        .body
        .as_deref()
        .filter(|notes| !notes.trim().is_empty())
    else {
        return failed_update(current_version);
    };
    let latest = latest_version.to_string();

    if latest_version > current {
        AppUpdate {
            latest_version: Some(latest.clone()),
            release_notes: truncate_notes(notes),
            release_notes_version: latest,
            status: "available",
            update_available: true,
        }
    } else if latest_version == current {
        AppUpdate {
            latest_version: Some(latest),
            release_notes: truncate_notes(notes),
            release_notes_version: current_version.to_owned(),
            status: "current",
            update_available: false,
        }
    } else {
        current_update(current_version, Some(latest))
    }
}

fn current_update(current_version: &str, latest_version: Option<String>) -> AppUpdate {
    AppUpdate {
        latest_version,
        release_notes: local_release_notes(current_version),
        release_notes_version: current_version.to_owned(),
        status: "current",
        update_available: false,
    }
}

fn failed_update(current_version: &str) -> AppUpdate {
    AppUpdate {
        latest_version: None,
        release_notes: local_release_notes(current_version),
        release_notes_version: current_version.to_owned(),
        status: "check-failed",
        update_available: false,
    }
}

fn local_release_notes(version: &str) -> String {
    // 内置当前版本日志，离线或 GitHub 不可用时仍可随时查看。
    let heading = format!("## [{version}] - ");
    let Some(start) = CHANGELOG.find(&heading) else {
        return format!("## [{version}]");
    };
    let section = &CHANGELOG[start..];
    let end = section
        .find("\n## [")
        .map_or(section.len(), |next_heading| next_heading);
    truncate_notes(section[..end].trim())
}

fn truncate_notes(notes: &str) -> String {
    if notes.len() <= MAX_RELEASE_NOTES_BYTES {
        return notes.trim().to_owned();
    }
    let mut end = MAX_RELEASE_NOTES_BYTES;
    while !notes.is_char_boundary(end) {
        end -= 1;
    }
    notes[..end].trim().to_owned()
}

#[cfg(test)]
mod tests {
    use super::{AppUpdate, resolve_release_response};

    #[test]
    fn newer_github_release_should_be_available_with_its_notes() {
        let update = resolve_release_response(
            "0.1.0",
            br###"[{"tag_name":"v0.2.0","body":"## Added\n\n- New flow"}]"###,
        );

        assert_eq!(
            update,
            AppUpdate {
                latest_version: Some("0.2.0".to_owned()),
                release_notes: "## Added\n\n- New flow".to_owned(),
                release_notes_version: "0.2.0".to_owned(),
                status: "available",
                update_available: true,
            }
        );
    }

    #[test]
    fn matching_github_release_should_be_current() {
        let update = resolve_release_response(
            "0.2.0",
            br#"[{"tag_name":"v0.2.0","body":"Current notes"}]"#,
        );

        assert_eq!(update.status, "current");
        assert!(!update.update_available);
        assert_eq!(update.release_notes_version, "0.2.0");
    }

    #[test]
    fn no_release_should_only_be_current_for_initial_version() {
        let initial = resolve_release_response("0.1.0", b"[]");
        let later = resolve_release_response("0.2.0", b"[]");

        assert_eq!(initial.status, "current");
        assert_eq!(initial.latest_version, None);
        assert_eq!(initial.release_notes_version, "0.1.0");
        assert_eq!(later.status, "check-failed");
    }
}
