#!/usr/bin/env bash
set -euo pipefail

archive="${1:?Desktop archive path is required}"
work_root="$(mktemp -d)"
package_name=""
app_pid=""

cleanup() {
  if [[ -n "${app_pid}" ]] && kill -0 "${app_pid}" 2>/dev/null; then
    kill -TERM "${app_pid}" 2>/dev/null || true
    wait "${app_pid}" 2>/dev/null || true
  fi
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

sudo apt-get install -y "${debs[0]}"
package_name="$(dpkg-deb -f "${debs[0]}" Package)"
mapfile -t executables < <(dpkg -L "${package_name}" | awk '/^\/usr\/bin\//')
[[ "${#executables[@]}" -eq 1 ]] || {
  echo "Expected one installed executable; found ${#executables[@]}" >&2
  exit 1
}

xvfb-run -a "${executables[0]}" >"${work_root}/desktop-deb.log" 2>&1 &
app_pid="$!"
for _ in {1..15}; do
  kill -0 "${app_pid}" 2>/dev/null || { cat "${work_root}/desktop-deb.log" >&2; exit 1; }
  sleep 1
done
kill -TERM "${app_pid}"
wait "${app_pid}" 2>/dev/null || true
app_pid=""

chmod +x "${appimages[0]}"
APPIMAGE_EXTRACT_AND_RUN=1 xvfb-run -a "${appimages[0]}" >"${work_root}/desktop-appimage.log" 2>&1 &
app_pid="$!"
for _ in {1..15}; do
  kill -0 "${app_pid}" 2>/dev/null || { cat "${work_root}/desktop-appimage.log" >&2; exit 1; }
  sleep 1
done

echo "Ubuntu Desktop release smoke passed."
