#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s --url URL --sha256 HEX [--app-dir DIR]\n' "$0" >&2
  printf 'Downloads a release DMG, verifies its SHA-256, checks the Mac architecture, and installs MVCAD.app.\n' >&2
}

url=
expected=
app_dir="/Applications"
while (($#)); do
  case "$1" in
    --url) [[ $# -ge 2 ]] || { usage; exit 2; }; url=$2; shift 2 ;;
    --sha256) [[ $# -ge 2 ]] || { usage; exit 2; }; expected=$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]'); shift 2 ;;
    --app-dir) [[ $# -ge 2 ]] || { usage; exit 2; }; app_dir=$2; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage; exit 2 ;;
  esac
done
[[ -n "$url" && -n "$expected" ]] || { usage; exit 2; }
[[ "$expected" =~ ^[0-9a-f]{64}$ ]] || { printf 'SHA-256 must be exactly 64 hexadecimal characters.\n' >&2; exit 2; }
[[ "$(uname -s)" == "Darwin" ]] || { printf 'This installer runs on macOS only.\n' >&2; exit 1; }

case "$(uname -m)" in
  arm64|x86_64) ;;
  *) printf 'Unsupported Mac architecture: %s (expected arm64 or x86_64).\n' "$(uname -m)" >&2; exit 1 ;;
esac
command -v curl >/dev/null || { printf 'curl is required.\n' >&2; exit 1; }
command -v hdiutil >/dev/null || { printf 'hdiutil is required.\n' >&2; exit 1; }
command -v ditto >/dev/null || { printf 'ditto is required.\n' >&2; exit 1; }
command -v shasum >/dev/null || { printf 'shasum is required.\n' >&2; exit 1; }
command -v file >/dev/null || { printf 'file is required to verify the application architecture.\n' >&2; exit 1; }

tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/mvcad-install.XXXXXX")
mount_dir="$tmp_dir/mount"
mkdir -p "$mount_dir"
cleanup() { hdiutil detach "$mount_dir" >/dev/null 2>&1 || true; rm -rf "$tmp_dir"; }
trap cleanup EXIT
dmg="$tmp_dir/MVCAD.dmg"
printf 'Downloading MVCAD...\n'
curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --output "$dmg" "$url"
actual=$(shasum -a 256 "$dmg" | awk '{print tolower($1)}')
[[ "$actual" == "$expected" ]] || { printf 'Checksum mismatch. Expected %s, got %s.\n' "$expected" "$actual" >&2; exit 1; }
hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$mount_dir" >/dev/null
app="$mount_dir/MVCAD.app"
[[ -d "$app" ]] || { printf 'The verified DMG does not contain MVCAD.app.\n' >&2; exit 1; }
binary="$app/Contents/MacOS/MVCAD"
[[ -x "$binary" ]] || { printf 'MVCAD.app is missing its executable.\n' >&2; exit 1; }
arch=$(uname -m)
file -b "$binary" | grep -Eq "(^|[^[:alnum:]_])${arch}([^[:alnum:]_]|$)" \
  || { printf 'MVCAD.app does not contain a %s executable.\n' "$arch" >&2; exit 1; }
mkdir -p "$app_dir"
if [[ -e "$app_dir/MVCAD.app" ]]; then
  printf 'MVCAD.app already exists in %s; remove it first to avoid overwriting an existing installation.\n' "$app_dir" >&2
  exit 1
fi
ditto "$app" "$app_dir/MVCAD.app"
printf 'Installed MVCAD.app in %s\n' "$app_dir"
