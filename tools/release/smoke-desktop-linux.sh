#!/usr/bin/env bash
set -euo pipefail

archive="${1:?Desktop archive path is required}"
work_root="$(mktemp -d)"
codex_home="${work_root}/codex-home"
package_name=""
tracked_patterns=()

cleanup() {
  for pattern in "${tracked_patterns[@]}"; do
    pkill -f "${pattern}" 2>/dev/null || true
  done
  if [[ -n "${package_name}" ]]; then
    run_privileged apt-get remove -y "${package_name}" >/dev/null || true
  fi
  rm -rf "${work_root}"
}
trap cleanup EXIT

track_pattern() {
  tracked_patterns+=("$1")
}

run_privileged() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

smoke_launch() {
  local log_path="$1"
  local process_pattern="$2"
  shift 2
  track_pattern "${process_pattern}"
  CODEX_HOME="${codex_home}" xvfb-run -a "$@" >"${log_path}" 2>&1 &
  local launcher_pid=$!
  for _ in {1..20}; do
    if pgrep -f "${process_pattern}" >/dev/null; then
      pkill -f "${process_pattern}" || true
      for _ in {1..5}; do
        pgrep -f "${process_pattern}" >/dev/null || break
        sleep 1
      done
      return 0
    fi
    if ! kill -0 "${launcher_pid}" 2>/dev/null; then
      wait "${launcher_pid}" 2>/dev/null || true
      cat "${log_path}" >&2
      return 1
    fi
    sleep 1
  done
  cat "${log_path}" >&2
  return 1
}

mkdir -p "${work_root}/bundle" "${codex_home}"
tar -xzf "${archive}" -C "${work_root}/bundle"
shopt -s nullglob
debs=("${work_root}"/bundle/deb/*.deb)
appimages=("${work_root}"/bundle/appimage/*.AppImage)
[[ "${#debs[@]}" -eq 1 ]] || { echo "Expected one DEB; found ${#debs[@]}" >&2; exit 1; }
[[ "${#appimages[@]}" -eq 1 ]] || { echo "Expected one AppImage; found ${#appimages[@]}" >&2; exit 1; }

package_name="$(dpkg-deb -f "${debs[0]}" Package)"
run_privileged apt-get install -y "${debs[0]}"
mapfile -t executables < <(dpkg -L "${package_name}" | awk '/^\/usr\/bin\//')
[[ "${#executables[@]}" -eq 1 ]] || {
  echo "Expected one installed executable; found ${#executables[@]}" >&2
  exit 1
}
deb_executable="${executables[0]}"

smoke_launch "${work_root}/desktop-deb.log" "${deb_executable}" "${deb_executable}"

appimage_extract="${work_root}/appimage-extract"
mkdir -p "${appimage_extract}"
chmod +x "${appimages[0]}"
(
  cd "${appimage_extract}"
  "${appimages[0]}" --appimage-extract >/dev/null
)
mapfile -t appimage_bins < <(find "${appimage_extract}/squashfs-root" -type f -perm -111 -name 'code-agent*')
[[ "${#appimage_bins[@]}" -eq 1 ]] || {
  echo "Expected one AppImage binary; found ${#appimage_bins[@]}" >&2
  exit 1
}
appimage_executable="${appimage_bins[0]}"

smoke_launch "${work_root}/desktop-appimage.log" "${appimage_executable}" "${appimage_executable}"

echo "Ubuntu Desktop release smoke passed."
