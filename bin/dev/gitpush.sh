#!/usr/bin/env bash
# Run the commit+push prepared by an AI agent in /tmp/commit/script (message in /tmp/commit/message).
# The prepared script disarms itself after a successful run, so a second gitpush is a no-op.
case "${1:-}" in -h|--help) sed -n '2,3p' "$0" | sed 's/^# //'; exit 0 ;; esac
s=/tmp/commit/script
[ -e "$s" ] || { echo "gitpush: nothing prepared ($s missing)" >&2; exit 1; }
# /tmp is shared: only run a regular file owned by this user
[ ! -L "$s" ] && [ -O "$s" ] && [ -O /tmp/commit ] || { echo "gitpush: refusing $s (symlink or not owned by $USER)" >&2; exit 1; }
[ -x "$s" ] || { echo "gitpush: $s is not executable" >&2; exit 1; }
# Merges never go through gitpush: they are prepared for gitmerge
! grep -q 'pr merge' "$s" || { echo "gitpush: $s merges a PR, refusing (use gitmerge)" >&2; exit 1; }
exec "$s" "$@"
