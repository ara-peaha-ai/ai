#!/usr/bin/env bash
# gitchat: open a named AI chat for the current folder, resuming it if it already exists.
#
# Usage:
#   gitchat --name email-verein               -> claude (default)
#   gitchat --ai claude --name email-verein

set -euo pipefail

usage() { sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; }

ai=claude
name=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ai) ai="${2:?--ai needs a value}"; shift 2 ;;
    --name|-n) name="${2:?--name needs a value}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

[ -n "$name" ] || { echo "Missing --name" >&2; usage >&2; exit 1; }
# ponytail: claude only, grok has no session names; add a name -> session-id map when grok is needed
[ "$ai" = claude ] || { echo "Only --ai claude is supported for now" >&2; exit 1; }

# ponytail: reads Claude Code's on-disk session format (projects/<cwd slug>/<id>.jsonl, "customTitle" record);
# breaks if Claude Code changes it
projects="$HOME/.claude/projects"
needle="\"customTitle\":\"$name\""
file=$(grep -lF "$needle" "$projects/$(pwd | sed 's/[^A-Za-z0-9]/-/g')"/*.jsonl 2>/dev/null | xargs -r -d '\n' ls -t | head -1 || true)

if [ -n "$file" ]; then
  id=$(basename "$file" .jsonl)
  echo "Resuming \"$name\" ($id), last activity $(date -r "$file" '+%Y-%m-%d %H:%M')"
  exec claude --resume "$id" -n "$name"
fi

# Sessions are per folder: warn when the same name lives elsewhere
other=$(grep -lF "$needle" "$projects"/*/*.jsonl 2>/dev/null | head -1 || true)
if [ -n "$other" ]; then
  echo "Note: \"$name\" exists in another folder: $(grep -o '"cwd":"[^"]*"' "$other" | head -1 | cut -d'"' -f4)"
fi
echo "New session \"$name\" in $(pwd)"
exec claude -n "$name"
