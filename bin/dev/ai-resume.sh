#!/usr/bin/env bash
# ai-resume (also `ai resume`): reopen AI chat sessions killed by a shutdown, crash or dead
# battery, one gnome-terminal tab each.
#
# Usage:
#   ai resume                          reopen every chat still open when a previous boot ended
#   ai resume --dry-run                list them, open nothing
#   ai resume --ai claude              (default, the only one supported for now)
#   ai-resume --register|--unregister  Claude Code SessionStart/SessionEnd hooks (install.sh adds them)

set -euo pipefail

usage() { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; }

# One file per open chat: "<boot id>\t<cwd>\t<transcript path>". SessionStart writes it, SessionEnd
# removes it only on an exit the user asked for, so a chat killed by anything else (shutdown,
# crash, power loss, however long it sat idle) stays listed with the boot it was open in.
reg="${XDG_STATE_HOME:-$HOME/.local/state}/ai-resume"
boot=$(cat /proc/sys/kernel/random/boot_id)

ai=claude
dry=0
while [ $# -gt 0 ]; do
  case "$1" in
    --register)
      in=$(cat); id=$(jq -r .session_id <<< "$in")
      mkdir -p "$reg"
      printf '%s\t%s\t%s\n' "$boot" "$(jq -r .cwd <<< "$in")" "$(jq -r .transcript_path <<< "$in")" > "$reg/$id"
      exit 0 ;;
    --unregister)
      in=$(cat)
      # ponytail: "other" (signal, closed terminal tab) keeps the entry, so a tab closed with the X
      # is reopened too; exit with /exit or Ctrl+D to drop a chat from the list
      case "$(jq -r .reason <<< "$in")" in
        prompt_input_exit|clear|logout) rm -f -- "$reg/$(jq -r .session_id <<< "$in")" ;;
      esac
      exit 0 ;;
    --ai) ai="${2:?--ai needs a value}"; shift 2 ;;
    --dry-run) dry=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

# ponytail: claude only; grok/codex need their own session registry and resume command
[ "$ai" = claude ] || { echo "Only --ai claude is supported for now" >&2; exit 1; }

found=0
for entry in "$reg"/*; do
  [ -f "$entry" ] || continue
  # A torn or empty record (power loss mid-write) is skipped, not fatal
  IFS=$'\t' read -r b cwd transcript < "$entry" || continue
  [ "$b" != "$boot" ] || continue
  found=1
  id=$(basename "$entry")
  name=$(jq -r 'select(.type == "custom-title") | .customTitle' "$transcript" 2>/dev/null | tail -n 1 || true)
  echo "$(date -r "$entry" '+%Y-%m-%d %H:%M')  $id  ${name:--}  $cwd"
  [ "$dry" = 0 ] || continue
  command -v gnome-terminal >/dev/null || { echo "gnome-terminal not found" >&2; exit 1; }
  [ -d "$cwd" ] || { echo "  skipped: folder no longer exists" >&2; rm -f -- "$entry"; continue; }
  # Unnamed sessions get no -n: claude then sets the tab title from its own topic
  gnome-terminal --tab --working-directory="$cwd" -- bash -c 'claude --resume "$1" ${2:+-n "$2"}; exec bash' _ "$id" "$name"
  # Dropped only once the tab opened; the resumed chat registers itself again with this boot
  rm -f -- "$entry"
  sleep 1
done
[ "$found" = 1 ] || echo "No killed $ai session found"
