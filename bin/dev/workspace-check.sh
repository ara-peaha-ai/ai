#!/usr/bin/env bash
# Claude Code SessionStart hook: warns when the session folder has no .claude/settings.json.
# Project permissions (the agent's merge rule among them) load only from the folder the session
# starts in, so a session in ~ or in a workspace without settings runs without them.
#   workspace-check --hook   reads the session JSON on stdin; prints nothing when the folder has settings
set -uo pipefail

cwd=$(jq -r '.cwd // empty' 2>/dev/null)
[ -n "$cwd" ] || exit 0
# in ~ that file is the user's own settings, never a workspace's
[ "$(cd "$cwd" 2>/dev/null && pwd -P)" != "$(cd "$HOME" && pwd -P)" ] && [ -f "$cwd/.claude/settings.json" ] && exit 0
msg="$cwd is not a workspace with its own .claude/settings.json: the workspace's agent permissions (merge included) are not loaded in this session. Reopen it in a workspace with: ai c --w <workspace> <chat name>; a workspace without that file gets it from: node <workspace>/os/scripts/link-project-settings.mjs <workspace>"
jq -n --arg m "$msg" '{systemMessage: $m, hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $m}}'
