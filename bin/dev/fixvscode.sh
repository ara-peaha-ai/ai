#!/usr/bin/env bash
# fixvscode
#
# Fix VS Code (Linux) drawing blank / empty editor windows. Cause: stale
# Electron GPU + shader caches. This script:
#   1. Snapshots the currently open workspaces/folders  (code --status)
#   2. Gracefully quits every VS Code window            (hot exit keeps unsaved edits)
#   3. Deletes only the GPU / shader cache dirs         (all regenerated on next launch)
#   4. Relaunches `code`; VS Code restores every window where it was
#      (relies on "window.restoreWindows": "all", the default since VS Code 1.75)
#
# Safe: touches only cache dirs under ~/.config/Code. Settings, extensions,
# keybindings and open files are never touched.
#
# ponytail: run this from a standalone terminal, not the VS Code integrated
# terminal — killing `code` would also kill the shell running this script.

set -euo pipefail

CFG="${XDG_CONFIG_HOME:-$HOME/.config}/Code"
SETTINGS="$CFG/User/settings.json"
SNAP="$CFG/logs/last-restore-snapshot.txt"

command -v code >/dev/null || { echo "error: 'code' CLI not found in PATH"; exit 1; }

echo "==> Snapshotting open windows"
mkdir -p "$CFG/logs"
timeout 20 code --status >"$SNAP" 2>/dev/null || echo "    (code --status timed out; windows likely hung — continuing)"
grep -E 'window \[' "$SNAP" | sed 's/^[[:space:]]*/    /' || echo "    (none detected)"
echo "    saved to $SNAP"

# Warn (don't edit) if restore was manually disabled — JSONC-safe, no parsing.
if [ -f "$SETTINGS" ] && grep -qE '"window\.restoreWindows"[[:space:]]*:[[:space:]]*"(none|one|preserve)"' "$SETTINGS"; then
  echo "    WARNING: window.restoreWindows is not \"all\" in settings.json —"
  echo "             windows may not all come back. Set it to \"all\" to fix that."
fi

echo "==> Quitting VS Code"
if pgrep -x code >/dev/null; then
  killall -TERM code 2>/dev/null || true
  for _ in $(seq 1 15); do pgrep -x code >/dev/null || break; sleep 1; done
  if pgrep -x code >/dev/null; then
    echo "    still running after 15s — forcing"
    killall -KILL code 2>/dev/null || true
    sleep 1
  fi
else
  echo "    (not running)"
fi
rm -f "$CFG/code.lock"

echo "==> Clearing GPU / shader caches"
for d in "GPUCache" "Code Cache" "DawnCache" "DawnGraphiteCache" "DawnWebGPUCache"; do
  rm -rf -- "$CFG/$d" && echo "    removed $d"
done

echo "==> Relaunching VS Code"
setsid code >/dev/null 2>&1 </dev/null &
disown 2>/dev/null || true
sleep 2

echo
echo "Done. VS Code is restarting and should restore these windows:"
grep -E 'window \[' "$SNAP" | sed 's/^[[:space:]]*/    /' || echo "    (snapshot empty — check manually)"
echo
echo "If windows are STILL blank, disable GPU acceleration as a fallback:"
echo "    printf '{ \"disable-hardware-acceleration\": true }\\n' > \"$CFG/argv.json\"   # then rerun this script"
