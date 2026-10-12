#!/usr/bin/env bash
# Run the PR merge prepared by an AI agent in /tmp/merge/script (what it merges in /tmp/merge/message).
# Separate from gitpush on purpose: a push never merges. The script disarms itself after a successful run.
case "${1:-}" in -h|--help) sed -n '2,3p' "$0" | sed 's/^# //'; exit 0 ;; esac
s=/tmp/merge/script
[ -e "$s" ] || { echo "gitmerge: nothing prepared ($s missing)" >&2; exit 1; }
# /tmp is shared: only run a regular file owned by this user
[ ! -L "$s" ] && [ -O "$s" ] && [ -O /tmp/merge ] || { echo "gitmerge: refusing $s (symlink or not owned by $USER)" >&2; exit 1; }
[ -x "$s" ] || { echo "gitmerge: $s is not executable" >&2; exit 1; }
m=/tmp/merge/message
[ -f "$m" ] && [ ! -L "$m" ] && [ -O "$m" ] || { echo "gitmerge: $m missing or not owned by $USER, nothing to show" >&2; exit 1; }
cat "$m"
# A merge is never run blind: the owner confirms what was just printed
read -rp "Merge this? [y/N] " answer
[ "$answer" = y ] || [ "$answer" = Y ] || { echo "gitmerge: cancelled"; exit 1; }
exec "$s" "$@"
