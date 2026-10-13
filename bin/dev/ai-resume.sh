#!/usr/bin/env bash
# ai-resume (also `ai resume`): reopen AI chat sessions killed by a shutdown or crash, one
# gnome-terminal tab each.
#
# Usage:
#   ai resume                          sessions killed by the last shutdown/crash (= --sessions last)
#   ai resume --sessions truncated     sessions killed by any shutdown/crash the journal remembers
#   ai resume --dry-run                list them, open nothing
#   ai resume --window 60              minutes before the boot end that count as "killed" (default 30)
#   ai resume --ai claude              (default, the only one supported for now)

set -euo pipefail

usage() { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; }

ai=claude
sessions=last
dry=0
window=30
while [ $# -gt 0 ]; do
  case "$1" in
    --ai) ai="${2:?--ai needs a value}"; shift 2 ;;
    --sessions) sessions="${2:?--sessions needs a value}"; shift 2 ;;
    --dry-run) dry=1; shift ;;
    --window) window="${2:?--window needs a value}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

case "$sessions" in last|truncated) ;; *) echo "--sessions must be last or truncated" >&2; exit 1 ;; esac
case "$window" in ''|*[!0-9]*) echo "--window must be a number of minutes" >&2; exit 1 ;; esac
# ponytail: claude only; grok/codex need their own session-file reader and resume command
[ "$ai" = claude ] || { echo "Only --ai claude is supported for now" >&2; exit 1; }

# End time (epoch) of every previous boot = its last journal record. Only the index column of
# `journalctl --list-boots` is read: its date layout changed in systemd 251 and is localized.
ends=$(journalctl --list-boots --no-pager |
  awk -v all="$([ "$sessions" = truncated ] && echo 1)" '$1 ~ /^-[0-9]+$/ && (all || $1 == -1) { print $1 }' |
  while read -r idx; do
    journalctl -b "$idx" -n 1 -o json --no-pager | jq -r '.__REALTIME_TIMESTAMP | tonumber / 1000000 | floor'
  done)
[ -n "$ends" ] || { echo "No previous boot in the journal" >&2; exit 1; }

# ponytail: "killed" = transcript last written in the --window minutes before a boot ended. Claude
# Code flushes open sessions on SIGTERM, so a clean shutdown is caught by any window; on a hard power
# loss (dead battery) nothing is flushed, so an open session only counts if it was last used inside
# the window, and a chat closed by hand inside it is reopened too. +300 s after the end because
# journald syncs to disk every 5 min, so after a power loss its last record lags the transcripts.
# History is as long as journald keeps it. Transcripts written after this boot started never count.
boot=$(awk '/^btime/ { print $2 }' /proc/stat)
files=$(find "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects" -mindepth 2 -maxdepth 2 -name '*.jsonl' -printf '%T@ %p\n' |
  awk -v ends="$(echo $ends)" -v w="$((window * 60))" -v boot="$boot" 'BEGIN { n = split(ends, e, " ") }
    { for (i = 1; i <= n; i++) if ($1 >= e[i] - w && $1 <= e[i] + 300 && $1 < boot) { print; next } }' |
  sort -n | cut -d' ' -f2-)
[ -n "$files" ] || { echo "No killed $ai session found"; exit 0; }

command -v gnome-terminal >/dev/null || [ "$dry" = 1 ] || { echo "gnome-terminal not found" >&2; exit 1; }

while IFS= read -r file; do
  id=$(basename "$file" .jsonl)
  cwd=$(grep -m1 '"cwd":' "$file" | jq -r .cwd || true)
  # Same record match as gitchat: line start only, so quoted transcripts do not count
  name=$(grep '^{"type":"custom-title","customTitle":' "$file" | tail -1 | jq -r .customTitle || true)
  echo "$(date -r "$file" '+%Y-%m-%d %H:%M')  $id  ${name:--}  $cwd"
  [ "$dry" = 0 ] || continue
  [ -d "$cwd" ] || { echo "  skipped: folder no longer exists" >&2; continue; }
  # Unnamed sessions get no -n: claude then sets the tab title from its own topic
  gnome-terminal --tab --working-directory="$cwd" -- bash -c 'claude --resume "$1" ${2:+-n "$2"}; exec bash' _ "$id" "$name"
  sleep 1
done <<< "$files"
