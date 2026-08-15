#!/usr/bin/env bash
set -euo pipefail

archive="${1:?Desktop archive path is required}"
work_root="$(mktemp -d)"
mount_point="${work_root}/mounted"
mounted=0
app_pid=""

cleanup() {
  if [[ -n "${app_pid}" ]] && kill -0 "${app_pid}" 2>/dev/null; then
    kill -TERM "${app_pid}" 2>/dev/null || true
    wait "${app_pid}" 2>/dev/null || true
  fi
  if [[ "${mounted}" -eq 1 ]]; then
    hdiutil detach "${mount_point}" -quiet || true
  fi
  rm -rf "${work_root}"
}
trap cleanup EXIT

mkdir -p "${mount_point}" "${work_root}/bundle"
tar -xzf "${archive}" -C "${work_root}/bundle"
shopt -s nullglob
dmgs=("${work_root}"/bundle/dmg/*.dmg)
[[ "${#dmgs[@]}" -eq 1 ]] || { echo "Expected one DMG; found ${#dmgs[@]}" >&2; exit 1; }
hdiutil attach "${dmgs[0]}" -nobrowse -readonly -mountpoint "${mount_point}" >/dev/null
mounted=1

apps=("${mount_point}"/*.app)
[[ "${#apps[@]}" -eq 1 ]] || { echo "Expected one app bundle; found ${#apps[@]}" >&2; exit 1; }
app_bundle="${apps[0]}"
executable="${app_bundle}/Contents/MacOS/code-agent-desktop"
[[ -x "${executable}" ]] || { echo "Desktop executable is missing: ${executable}" >&2; exit 1; }

"${executable}" >"${work_root}/desktop.log" 2>&1 &
app_pid="$!"
for _ in {1..20}; do
  kill -0 "${app_pid}" 2>/dev/null || { cat "${work_root}/desktop.log" >&2; exit 1; }
  sleep 1
done

echo "macOS Desktop release smoke passed."
