#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
archive_input="${1:-${repo_root}/.artifacts/desktop/code-agent-desktop-linux-x64-gnu.tar.gz}"

if [[ "${archive_input}" = /* ]]; then
  archive_abs="${archive_input}"
else
  archive_abs="${repo_root}/${archive_input}"
fi

if [[ ! -f "${archive_abs}" ]]; then
  echo "Desktop archive is missing: ${archive_abs}" >&2
  echo "Download one with:" >&2
  echo "  gh run download <run-id> -R BryanHoo/CodeAgent -n desktop-linux-x64-gnu -D ${repo_root}/.artifacts/desktop" >&2
  exit 1
fi

archive_in_container="/workspace/${archive_abs#${repo_root}/}"

docker run --rm --platform linux/amd64 \
  -v "${repo_root}:/workspace" \
  -w /workspace \
  ubuntu:22.04 \
  bash -lc "
    set -euo pipefail
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y xvfb procps dpkg-dev findutils ca-certificates sudo
    bash tools/release/smoke-desktop-linux.sh '${archive_in_container}'
  "
