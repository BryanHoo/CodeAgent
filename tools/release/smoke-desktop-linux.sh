#!/usr/bin/env bash
set -euo pipefail

archive="${1:?Desktop archive path is required}"
work_root="$(mktemp -d)"
package_name=""
app_pid=""

stop_app() {
  if [[ -z "${app_pid}" ]]; then
    return
  fi
  if kill -0 -- "-${app_pid}" 2>/dev/null; then
    kill -TERM -- "-${app_pid}" 2>/dev/null || true
    for _ in {1..5}; do
      kill -0 -- "-${app_pid}" 2>/dev/null || break
      sleep 1
    done
    if kill -0 -- "-${app_pid}" 2>/dev/null; then
      kill -KILL -- "-${app_pid}" 2>/dev/null || true
    fi
  fi
  wait "${app_pid}" 2>/dev/null || true
  app_pid=""
}

smoke_app() {
  local log_path="$1"
  shift
  # 独立 session 让退出路径能同时回收 xvfb、Desktop 与 Codex 子进程。
  setsid "$@" >"${log_path}" 2>&1 &
  app_pid="$!"
  for _ in {1..15}; do
    kill -0 -- "-${app_pid}" 2>/dev/null || { cat "${log_path}" >&2; wait "${app_pid}" || true; app_pid=""; return 1; }
    sleep 1
  done
  stop_app
}

cleanup() {
  stop_app
  if [[ -n "${package_name}" ]]; then
    sudo apt-get remove -y "${package_name}" >/dev/null || true
  fi
  rm -rf "${work_root}"
}
trap cleanup EXIT

mkdir -p "${work_root}/bundle"
tar -xzf "${archive}" -C "${work_root}/bundle"
shopt -s nullglob
debs=("${work_root}"/bundle/deb/*.deb)
appimages=("${work_root}"/bundle/appimage/*.AppImage)
[[ "${#debs[@]}" -eq 1 ]] || { echo "Expected one DEB; found ${#debs[@]}" >&2; exit 1; }
[[ "${#appimages[@]}" -eq 1 ]] || { echo "Expected one AppImage; found ${#appimages[@]}" >&2; exit 1; }

package_name="$(dpkg-deb -f "${debs[0]}" Package)"
sudo apt-get install -y "${debs[0]}"
mapfile -t executables < <(dpkg -L "${package_name}" | awk '/^\/usr\/bin\//')
[[ "${#executables[@]}" -eq 1 ]] || {
  echo "Expected one installed executable; found ${#executables[@]}" >&2
  exit 1
}

smoke_app "${work_root}/desktop-deb.log" xvfb-run -a "${executables[0]}"

chmod +x "${appimages[0]}"
smoke_app "${work_root}/desktop-appimage.log" env APPIMAGE_EXTRACT_AND_RUN=1 xvfb-run -a "${appimages[0]}"

echo "Ubuntu Desktop release smoke passed."
