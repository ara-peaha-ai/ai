#!/usr/bin/env bash
# Install or update every ai-cli command on this machine. Safe to re-run.
#   ./install.sh               npm deps, global commands (npm link), shell aliases, auto-update hook
#   ./install.sh --with-face   also build the enhance-face stack (~2 GB, CPU torch + GFPGAN weights)
#   ./install.sh --with-bg-video   also build the remove-bg-video stack (~1 GB, CPU torch + RVM weights)
# System tools the commands shell out to (ffmpeg, imagemagick, qrencode, jq, gallery-dl) are
# listed in README.md; this script does not apt-install them.
set -euo pipefail

with_face=0
with_bg_video=0
for arg in "$@"; do
  case "$arg" in
    --with-face) with_face=1 ;;
    --with-bg-video) with_bg_video=1 ;;
    -h|--help) sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 1 ;;
  esac
done

repo="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
cd "$repo"

npm install --no-audit --no-fund
npm link --no-audit --no-fund

# Drop global command links left dangling by renamed/removed commands
gbin="$(npm prefix -g)/bin"
find "$gbin" -maxdepth 1 -xtype l -lname '*ai-cli/bin/*' -print -delete | sed 's#^#removed stale link: #'

# Re-run this script after every `git pull` that changes the command list
git config core.hooksPath .githooks

line="[ -f \"$repo/shell/aliases.sh\" ] && . \"$repo/shell/aliases.sh\""
grep -qF "$repo/shell/aliases.sh" "$HOME/.bashrc" 2>/dev/null || {
  printf '\n# ai-cli aliases\n%s\n' "$line" >> "$HOME/.bashrc"
  echo "added aliases to ~/.bashrc (open a new terminal to load them)"
}

[ "$with_face" = 0 ] || bin/ai/enhance-face-setup.sh
[ "$with_bg_video" = 0 ] || bin/ai/remove-bg-video-setup.sh

echo "ok: $(node -e "console.log(Object.keys(require('./package.json').bin).length)") commands linked into $gbin"
