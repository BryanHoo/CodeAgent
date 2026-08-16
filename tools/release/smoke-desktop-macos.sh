#!/usr/bin/env bash
set -euo pipefail

archive="${1:?Desktop archive path is required}"
work_root="$(mktemp -d)"
mount_point="${work_root}/mounted"
extract_root="${work_root}/extracted-app"
codex_home="${work_root}/codex-home"
mounted=0

cleanup() {
  pkill -x code-agent-desktop 2>/dev/null || true
  if [[ "${mounted}" -eq 1 ]]; then
    hdiutil detach "${mount_point}" -quiet || true
  fi
  rm -rf "${work_root}"
}
trap cleanup EXIT

mkdir -p "${mount_point}" "${work_root}/bundle" "${extract_root}" "${codex_home}"
tar -xzf "${archive}" -C "${work_root}/bundle"
shopt -s nullglob

app_bundle=""
apps=("${work_root}"/bundle/macos/*.app)
if [[ "${#apps[@]}" -eq 1 ]]; then
  app_bundle="${apps[0]}"
fi

if [[ -z "${app_bundle}" ]]; then
  app_archives=("${work_root}"/bundle/macos/*.app.tar.gz)
  if [[ "${#app_archives[@]}" -eq 1 ]]; then
    tar -xzf "${app_archives[0]}" -C "${extract_root}"
    apps=("${extract_root}"/*.app)
    [[ "${#apps[@]}" -eq 1 ]] || { echo "Expected one app bundle in archive; found ${#apps[@]}" >&2; exit 1; }
    app_bundle="${apps[0]}"
  fi
fi

if [[ -z "${app_bundle}" ]]; then
  dmgs=("${work_root}"/bundle/dmg/*.dmg)
  [[ "${#dmgs[@]}" -eq 1 ]] || { echo "Expected one installable macOS Desktop artifact; found ${#dmgs[@]} DMG(s)" >&2; exit 1; }
  hdiutil attach "${dmgs[0]}" -nobrowse -readonly -mountpoint "${mount_point}" >/dev/null
  mounted=1
  apps=("${mount_point}"/*.app)
  [[ "${#apps[@]}" -eq 1 ]] || { echo "Expected one app bundle; found ${#apps[@]}" >&2; exit 1; }
  app_bundle="${apps[0]}"
fi

executable="${app_bundle}/Contents/MacOS/code-agent-desktop"
[[ -x "${executable}" ]] || { echo "Desktop executable is missing: ${executable}" >&2; exit 1; }

# 通过 .app 启动，避免直接执行 Mach-O 时 Tauri 无法解析 home/resource 路径。
open -n -a "${app_bundle}" --env "CODEX_HOME=${codex_home}" >/dev/null
for _ in {1..20}; do
  if pgrep -x code-agent-desktop >/dev/null; then
    pkill -x code-agent-desktop || true
    echo "macOS Desktop release smoke passed."
    exit 0
  fi
  sleep 1
done

echo "Desktop app did not stay alive after launch." >&2
exit 1
