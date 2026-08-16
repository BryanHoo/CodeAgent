#!/usr/bin/env bash
set -euo pipefail

archive="${1:?Desktop archive path is required}"
work_root="$(mktemp -d)"
codex_home="${work_root}/codex-home"
package_name=""

cleanup() {
  pkill -x code-agent-desktop 2>/dev/null || true
  pkill -x code-agent 2>/dev/null || true
  if [[ -n "${package_name}" ]]; then
    sudo apt-get remove -y "${package_name}" >/dev/null || true
  fi
  rm -rf "${work_root}"
}
trap cleanup EXIT

smoke_launch() {
  local log_path="$1"
  local process_name="$2"
  shift 2
  CODEX_HOME="${codex_home}" xvfb-run -a "$@" >"${log_path}" 2>&1 &
  local launcher_pid=$!
  for _ in {1..20}; do
    if pgrep -x "${process_name}" >/dev/null; then
      pkill -x "${process_name}" || true
      for _ in {1..5}; do
        pgrep -x "${process_name}" >/dev/null || break
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
sudo apt-get install -y "${debs[0]}"
mapfile -t executables < <(dpkg -L "${package_name}" | awk '/^\/usr\/bin\//')
[[ "${#executables[@]}" -eq 1 ]] || {
  echo "Expected one installed executable; found ${#executables[@]}" >&2
  exit 1
}
deb_process_name="$(basename "${executables[0]}")"

smoke_launch "${work_root}/desktop-deb.log" "${deb_process_name}" "${executables[0]}"

chmod +x "${appimages[0]}"
smoke_launch "${work_root}/desktop-appimage.log" code-agent-desktop env APPIMAGE_EXTRACT_AND_RUN=1 "${appimages[0]}"

echo "Ubuntu Desktop release smoke passed."
