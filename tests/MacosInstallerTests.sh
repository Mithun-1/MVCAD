#!/usr/bin/env bash
set -euo pipefail

root_dir=$(cd "$(dirname "$0")/.." && pwd)
installer="$root_dir/scripts/install-macos.sh"
test_root=$(mktemp -d "${TMPDIR:-/tmp}/mvcad-installer-tests.XXXXXX")
trap 'rm -rf "$test_root"' EXIT
mock_bin="$test_root/bin"
mkdir -p "$mock_bin"

if command -v shasum >/dev/null 2>&1; then
  native_hash_tool=$(command -v shasum)
  native_hash_mode=shasum
elif command -v sha256sum >/dev/null 2>&1; then
  native_hash_tool=$(command -v sha256sum)
  native_hash_mode=sha256sum
else
  printf '%s\n' 'A SHA-256 utility is required to run this test.' >&2
  exit 1
fi

printf '%s\n' '#!/usr/bin/env bash' 'case "${1:-}" in -s) printf "%s\n" "${MOCK_UNAME_S:-Darwin}";; -m) printf "%s\n" "${MOCK_UNAME_M:-arm64}";; *) exit 2;; esac' >"$mock_bin/uname"
printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' 'output=' 'for ((i=1;i<= $#;i++)); do if [[ "${!i}" == --output ]]; then ((i++)); output=${!i}; fi; done' 'printf "%s" "${MOCK_DMG_BYTES:-MVCAD test DMG bytes}" >"$output"' >"$mock_bin/curl"
printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' 'if [[ "${1:-}" == detach ]]; then exit 0; fi' 'mountpoint=' 'for ((i=1;i<= $#;i++)); do if [[ "${!i}" == -mountpoint ]]; then ((i++)); mountpoint=${!i}; fi; done' 'mkdir -p "$mountpoint/MVCAD.app/Contents/MacOS"' 'printf "#!/bin/sh\n" >"$mountpoint/MVCAD.app/Contents/MacOS/MVCAD"' 'chmod +x "$mountpoint/MVCAD.app/Contents/MacOS/MVCAD"' >"$mock_bin/hdiutil"
printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' 'cp -R "$1" "$2"' >"$mock_bin/ditto"
printf '%s\n' '#!/usr/bin/env bash' 'printf "%s executable\\n" "${MOCK_FILE_ARCH:-arm64}"' >"$mock_bin/file"
printf '%s\n' '#!/usr/bin/env bash' '[[ "${1:-}" == -a && "${2:-}" == 256 ]] || exit 2' 'shift 2' 'if [[ "$REAL_HASH_MODE" == shasum ]]; then "$REAL_HASH_TOOL" -a 256 "$1"; else "$REAL_HASH_TOOL" "$1"; fi' >"$mock_bin/shasum"
chmod +x "$mock_bin"/*

payload='MVCAD test DMG bytes'
if [[ "$native_hash_mode" == shasum ]]; then
  valid_sha=$(printf '%s' "$payload" | "$native_hash_tool" -a 256 | awk '{print tolower($1)}')
else
  valid_sha=$(printf '%s' "$payload" | "$native_hash_tool" | awk '{print tolower($1)}')
fi

run_installer() {
  local app_dir=$1 sha=$2 case_tmp=$3
  env PATH="$mock_bin:$PATH" TMPDIR="$case_tmp" MOCK_DMG_BYTES="$payload" MOCK_UNAME_S=Darwin MOCK_UNAME_M=arm64 MOCK_FILE_ARCH=arm64 REAL_HASH_TOOL="$native_hash_tool" REAL_HASH_MODE="$native_hash_mode" bash "$installer" --url https://example.invalid/MVCAD.dmg --sha256 "$sha" --app-dir "$app_dir"
}

valid_install() {
  local d="$test_root/valid"; mkdir -p "$d/apps" "$d/tmp"
  run_installer "$d/apps" "$valid_sha" "$d/tmp" >/dev/null
  [[ -x "$d/apps/MVCAD.app/Contents/MacOS/MVCAD" ]]
}

checksum_mismatch() {
  local d="$test_root/checksum"; mkdir -p "$d/apps" "$d/tmp"
  if run_installer "$d/apps" "0000000000000000000000000000000000000000000000000000000000000000" "$d/tmp" >/dev/null 2>&1; then
    printf '%s\n' 'Checksum mismatch was accepted.' >&2
    return 1
  fi
  [[ ! -e "$d/apps/MVCAD.app" ]]
}

wrong_architecture() {
  local d="$test_root/architecture"; mkdir -p "$d/apps" "$d/tmp"
  if env PATH="$mock_bin:$PATH" TMPDIR="$d/tmp" MOCK_DMG_BYTES="$payload" MOCK_UNAME_S=Darwin MOCK_UNAME_M=arm64 MOCK_FILE_ARCH=x86_64 REAL_HASH_TOOL="$native_hash_tool" REAL_HASH_MODE="$native_hash_mode" bash "$installer" --url https://example.invalid/MVCAD.dmg --sha256 "$valid_sha" --app-dir "$d/apps" >/dev/null 2>&1; then
    printf '%s\n' 'Wrong application architecture was accepted.' >&2
    return 1
  fi
  [[ ! -e "$d/apps/MVCAD.app" ]]
}

existing_app_preserved() {
  local d="$test_root/existing"; mkdir -p "$d/apps/MVCAD.app" "$d/tmp"
  printf '%s\n' 'existing installation' >"$d/apps/MVCAD.app/sentinel.txt"
  if run_installer "$d/apps" "$valid_sha" "$d/tmp" >/dev/null 2>&1; then
    printf '%s\n' 'Existing application was overwritten.' >&2
    return 1
  fi
  [[ "$(<"$d/apps/MVCAD.app/sentinel.txt")" == 'existing installation' ]]
}

valid_install
checksum_mismatch
wrong_architecture
existing_app_preserved
printf '%s\n' 'MacOS installer tests passed.'
