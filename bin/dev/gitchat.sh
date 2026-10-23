#!/usr/bin/env bash
# gitchat: open a named AI chat for the current folder, resuming it if it already exists.
#
# Usage:
#   gitchat --name email-verein               -> claude (default)
#   gitchat --ai claude --name email-verein
# Started in ~ (desktop terminals), a name not found in ~ is resumed or created in the project
# folder (AI_CHAT_HOME, default: the folder holding this repo), where project permissions load.

set -euo pipefail

usage() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; }

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
case "$name" in *\"*|*\\*) echo "--name cannot contain \" or \\" >&2; exit 1 ;; esac
# ponytail: claude only, grok has no session names; add a name -> session-id map when grok is needed
[ "$ai" = claude ] || { echo "Only --ai claude is supported for now" >&2; exit 1; }

# ponytail: reads Claude Code's on-disk session format (projects/<cwd slug>/<id>.jsonl, one
# {"type":"custom-title","customTitle":...} record per line, written by /rename); breaks if Claude Code changes it
shopt -u nullglob failglob
projects="$HOME/.claude/projects"
record="{\"type\":\"custom-title\",\"customTitle\":\"$name\","
# Match the record at line start only: transcripts that merely quote it must not count
find_named() { awk -v p="$record" 'index($0, p) == 1 { print FILENAME; nextfile }' "$@" 2>/dev/null || true; }

named_here() { find_named "$projects/$(pwd | sed 's/[^A-Za-z0-9]/-/g')"/*.jsonl | xargs -r -d '\n' ls -t | head -1; }
file=$(named_here)

# ~ loads no project settings: chats already in ~ resume there, new ones move to the project folder
if [ -z "$file" ] && [ "$(pwd -P)" = "$(cd "$HOME" && pwd -P)" ]; then
  cd -P -- "${AI_CHAT_HOME:-$(cd "$(dirname "$(readlink -f "$0")")/../../.." && pwd)}"
  file=$(named_here)
fi

if [ -n "$file" ]; then
  id=$(basename "$file" .jsonl)
  echo "Resuming \"$name\" ($id), last activity $(date -r "$file" '+%Y-%m-%d %H:%M')"
  exec claude --resume "$id"
fi

# Sessions are per folder: warn when the same name lives elsewhere
other=$(find_named "$projects"/*/*.jsonl | head -1)
if [ -n "$other" ]; then
  echo "Note: \"$name\" exists in another folder: $(grep -o '"cwd":"[^"]*"' "$other" | head -1 | cut -d'"' -f4)"
fi
echo "New session \"$name\" in $(pwd)"
# ponytail: /rename as the first message, once the chat is open: the hidden `claude -n` failed about half the time
exec claude "/rename $name"
