#!/usr/bin/env bash
# Run the PR merge prepared by an AI agent in /tmp/merge/script (what it merges in /tmp/merge/message).
# Separate from gitpush on purpose: a push never merges. Both files are removed after a successful run.
case "${1:-}" in -h|--help) sed -n '2,3p' "$0" | sed 's/^# //'; exit 0 ;; esac
[ $# = 0 ] || { echo "gitmerge: takes no arguments" >&2; exit 1; }
d=/tmp/merge s=/tmp/merge/script m=/tmp/merge/message
[ -e "$s" ] || [ -L "$s" ] || { echo "gitmerge: nothing pending" >&2; exit 1; }
# /tmp is shared: only a real folder and regular files owned by this user
# ponytail: a guard against agent mistakes on a single-user machine, not against a local attacker (no hash pinning)
[ -d "$d" ] && [ ! -L "$d" ] && [ -O "$d" ] || { echo "gitmerge: refusing $d (symlink or not owned by $USER)" >&2; exit 1; }
[ -f "$s" ] && [ ! -L "$s" ] && [ -O "$s" ] && [ -x "$s" ] || { echo "gitmerge: refusing $s (not an executable regular file owned by $USER)" >&2; exit 1; }
[ -f "$m" ] && [ ! -L "$m" ] && [ -O "$m" ] || { echo "gitmerge: $m missing or not owned by $USER, nothing to show" >&2; exit 1; }
# A merge is never run blind: the owner reads both files (control characters made visible) and confirms at a terminal
cat -v "$m" || exit 1
echo "--- $s"
cat -v "$s" || exit 1
[ -t 0 ] || { echo "gitmerge: needs a terminal to confirm" >&2; exit 1; }
read -rp "Merge this? [y/N] " answer
[ "$answer" = y ] || [ "$answer" = Y ] || { echo "gitmerge: cancelled" >&2; exit 1; }
"$s" && rm -f -- "$s" "$m"
