use std::{
    path::{Path, PathBuf},
    sync::{
        OnceLock,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use futures_util::StreamExt;
use reqwest::{Client, Response, Url, header, redirect::Policy};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncWriteExt},
    sync::Mutex,
};

use super::error::AppError;

const BING_ORIGIN: &str = "https://www.bing.com";
const BING_METADATA_URL: &str =
    "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN";
const MAX_METADATA_BYTES: usize = 64 * 1_024;
const MAX_WALLPAPER_BYTES: usize = 20 * 1_024 * 1_024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
static DOWNLOAD_LOCK: Mutex<()> = Mutex::const_new(());
static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();
static STAGING_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchBackgroundResponse {
    asset_path: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_workbench_background(
    app: AppHandle,
    day: String,
) -> Result<WorkbenchBackgroundResponse, AppError> {
    if !is_valid_day(&day) {
        return Err(AppError::WorkbenchBackgroundUnavailable);
    }
    let _guard = DOWNLOAD_LOCK.lock().await;
    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|_| AppError::WorkbenchBackgroundUnavailable)?
        .join("workbench-background/bing");
    fs::create_dir_all(&cache_root)
        .await
        .map_err(|_| AppError::WorkbenchBackgroundUnavailable)?;
    let destination = cache_root.join(format!("bing-{day}.jpg"));
    let asset = match validated_cache_path(&cache_root, &destination).await {
        Some(path) => path,
        None => {
            let bytes = fetch_wallpaper().await?;
            write_cache(&cache_root, &destination, &bytes).await?;
            cleanup_old_cache_files(&cache_root, &destination).await;
            validated_cache_path(&cache_root, &destination)
                .await
                .ok_or(AppError::WorkbenchBackgroundUnavailable)?
        }
    };
    app.asset_protocol_scope()
        .allow_file(&asset)
        .map_err(|_| AppError::WorkbenchBackgroundUnavailable)?;
    Ok(WorkbenchBackgroundResponse {
        asset_path: asset.to_string_lossy().into_owned(),
    })
}

fn http_client() -> Result<&'static Client, AppError> {
    if let Some(client) = HTTP_CLIENT.get() {
        return Ok(client);
    }
    let client = Client::builder()
        .redirect(Policy::none())
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|_| AppError::WorkbenchBackgroundUnavailable)?;
    let _ = HTTP_CLIENT.set(client);
    HTTP_CLIENT
        .get()
        .ok_or(AppError::WorkbenchBackgroundUnavailable)
}

async fn fetch_wallpaper() -> Result<Vec<u8>, AppError> {
    // 禁止重定向并二次校验固定域名与路径，避免远端元数据把桌面端变成任意 URL 下载器。
    let metadata_response = http_client()?
        .get(BING_METADATA_URL)
        .header(header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|_| AppError::WorkbenchBackgroundUnavailable)?;
    if !metadata_response.status().is_success()
        || metadata_response.url().as_str() != BING_METADATA_URL
        || !has_content_type(&metadata_response, "application/json")
    {
        return Err(AppError::WorkbenchBackgroundUnavailable);
    }
    let metadata = read_bounded_body(metadata_response, MAX_METADATA_BYTES).await?;
    let image_url = read_image_url(&metadata).ok_or(AppError::WorkbenchBackgroundUnavailable)?;
    let image_response = http_client()?
        .get(&image_url)
        .header(header::ACCEPT, "image/jpeg")
        .send()
        .await
        .map_err(|_| AppError::WorkbenchBackgroundUnavailable)?;
    if !image_response.status().is_success()
        || !is_bing_image_url(image_response.url())
        || !has_content_type(&image_response, "image/jpeg")
    {
        return Err(AppError::WorkbenchBackgroundUnavailable);
    }
    let bytes = read_bounded_body(image_response, MAX_WALLPAPER_BYTES).await?;
    is_jpeg(&bytes)
        .then_some(bytes)
        .ok_or(AppError::WorkbenchBackgroundUnavailable)
}

fn has_content_type(response: &Response, expected: &str) -> bool {
    response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.to_ascii_lowercase().starts_with(expected))
}

async fn read_bounded_body(response: Response, maximum_bytes: usize) -> Result<Vec<u8>, AppError> {
    // 同时检查 Content-Length 和实际流量，兼容分块响应并限制内存峰值。
    if response
        .content_length()
        .is_some_and(|length| length > maximum_bytes as u64)
    {
        return Err(AppError::WorkbenchBackgroundUnavailable);
    }
    let mut bytes = Vec::with_capacity(
        response
            .content_length()
            .and_then(|length| usize::try_from(length).ok())
            .unwrap_or(64 * 1_024)
            .min(maximum_bytes),
    );
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| AppError::WorkbenchBackgroundUnavailable)?;
        if bytes.len() + chunk.len() > maximum_bytes {
            return Err(AppError::WorkbenchBackgroundUnavailable);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn read_image_url(metadata: &[u8]) -> Option<String> {
    let payload: Value = serde_json::from_slice(metadata).ok()?;
    let path = payload
        .get("images")?
        .as_array()?
        .first()?
        .get("url")?
        .as_str()?;
    if !path.starts_with('/') {
        return None;
    }
    let url = Url::parse(BING_ORIGIN).ok()?.join(path).ok()?;
    is_bing_image_url(&url).then(|| url.to_string())
}

fn is_bing_image_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("www.bing.com")
        && url.port().is_none()
        && url.path() == "/th"
        && url.fragment().is_none()
}

async fn validated_cache_path(root: &Path, path: &Path) -> Option<PathBuf> {
    let metadata = fs::metadata(path).await.ok()?;
    if !metadata.is_file() || !(4..=MAX_WALLPAPER_BYTES as u64).contains(&metadata.len()) {
        return None;
    }
    let mut file = fs::File::open(path).await.ok()?;
    let mut signature = [0_u8; 3];
    file.read_exact(&mut signature).await.ok()?;
    if !is_jpeg(&signature) {
        return None;
    }
    let canonical_root = fs::canonicalize(root).await.ok()?;
    let canonical_path = fs::canonicalize(path).await.ok()?;
    canonical_path
        .starts_with(canonical_root)
        .then_some(canonical_path)
}

async fn write_cache(root: &Path, destination: &Path, bytes: &[u8]) -> Result<(), AppError> {
    // 先完整落盘并同步临时文件，再替换正式缓存，避免中断后留下半张图片。
    let staging = root.join(format!(
        ".bing.download-{}-{}",
        std::process::id(),
        STAGING_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&staging)
        .await
        .map_err(|_| AppError::WorkbenchBackgroundUnavailable)?;
    if file.write_all(bytes).await.is_err() || file.sync_all().await.is_err() {
        let _ = fs::remove_file(&staging).await;
        return Err(AppError::WorkbenchBackgroundUnavailable);
    }
    drop(file);
    if destination.exists() {
        fs::remove_file(destination)
            .await
            .map_err(|_| AppError::WorkbenchBackgroundUnavailable)?;
    }
    if fs::rename(&staging, destination).await.is_err() {
        let _ = fs::remove_file(&staging).await;
        return Err(AppError::WorkbenchBackgroundUnavailable);
    }
    Ok(())
}

async fn cleanup_old_cache_files(root: &Path, current: &Path) {
    let Ok(mut entries) = fs::read_dir(root).await else {
        return;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path != current && path.extension().and_then(|value| value.to_str()) == Some("jpg") {
            let _ = fs::remove_file(path).await;
        }
    }
}

fn is_valid_day(day: &str) -> bool {
    let bytes = day.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes
            .iter()
            .enumerate()
            .any(|(index, byte)| index != 4 && index != 7 && !byte.is_ascii_digit())
    {
        return false;
    }
    let year = day[0..4].parse::<u32>().ok();
    let month = day[5..7].parse::<u32>().ok();
    let date = day[8..10].parse::<u32>().ok();
    let (Some(year), Some(month), Some(date)) = (year, month, date) else {
        return false;
    };
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let maximum = match month {
        2 => 28 + u32::from(leap),
        4 | 6 | 9 | 11 => 30,
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => return false,
    };
    (1..=maximum).contains(&date)
}

fn is_jpeg(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0xff, 0xd8, 0xff])
}

#[cfg(test)]
mod tests {
    use super::{fetch_wallpaper, is_jpeg, is_valid_day, read_image_url};

    #[test]
    fn bing_metadata_should_only_accept_fixed_image_endpoint() {
        let metadata = br#"{"images":[{"url":"/th?id=OHR.Workbench.jpg&pid=hp"}]}"#;
        assert_eq!(
            read_image_url(metadata).as_deref(),
            Some("https://www.bing.com/th?id=OHR.Workbench.jpg&pid=hp")
        );
        assert!(read_image_url(br#"{"images":[{"url":"https://example.com/a.jpg"}]}"#).is_none());
        assert!(read_image_url(br#"{"images":[{"url":"/not-th?id=a"}]}"#).is_none());
    }

    #[test]
    fn cache_key_and_image_signature_should_be_strict() {
        assert!(is_valid_day("2026-08-25"));
        assert!(!is_valid_day("2026-02-30"));
        assert!(!is_valid_day("../../escape"));
        assert!(is_jpeg(&[0xff, 0xd8, 0xff, 0xd9]));
        assert!(!is_jpeg(b"not-a-jpeg"));
    }

    #[tokio::test]
    #[ignore = "requires Bing network access"]
    async fn bing_should_download_a_real_jpeg() {
        let bytes = fetch_wallpaper()
            .await
            .expect("Bing should return a valid wallpaper");
        assert!(bytes.len() > 4);
        assert!(is_jpeg(&bytes));
    }
}
