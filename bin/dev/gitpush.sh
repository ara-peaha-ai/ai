#!/usr/bin/env bash
# Run a push an AI agent prepared in a gitpool entry, <project>/.gitpool/<repo>/<id>/{script,message}.
# Usage: gitpush [<repo>/<id>]  (no argument: the only pending entry, or pick one when there are several)
case "${1:-}" in -h|--help) sed -n '2,3p' "$0" | sed 's/^# //'; exit 0 ;; esac

# The pool of the project you are in; anywhere else, the pools of every project next to this tool's own
pools=()
d="$PWD"
while [ "$d" != / ]; do [ -d "$d/.gitpool" ] && { pools=("$d/.gitpool"); break; }; d="$(dirname "$d")"; done
if [ ${#pools[@]} = 0 ]; then
  projects="$(dirname "$(dirname "$(dirname "$(dirname "$(dirname "$(readlink -f "$0")")")")")")"
  for p in "$projects"/*/.gitpool; do [ -d "$p" ] && pools+=("$p"); done
fi

entries=()
for p in "${pools[@]}"; do
  for s in "$p"/*/*/script; do [ -e "$s" ] && entries+=("$(dirname "$s")"); done
done
if [ -n "${1:-}" ]; then
  mapfile -t entries < <(for x in "${entries[@]}"; do [[ "$x" == */.gitpool/"$1" ]] && echo "$x"; done)
  [ ${#entries[@]} = 1 ] || { echo "gitpush: no single entry matches $1" >&2; exit 1; }
fi
case ${#entries[@]} in
  0) echo "gitpush: nothing prepared" >&2; exit 1 ;;
  1) e="${entries[0]}" ;;
  *) labels=()
     for x in "${entries[@]}"; do labels+=("$(basename "$(dirname "$(dirname "$(dirname "$x")")")")/${x#*/.gitpool/} — $(head -1 "$x/message" 2>/dev/null)"); done
     PS3="Which push? "
     select l in "${labels[@]}"; do [ -n "$l" ] && { e="${entries[REPLY-1]}"; break; }; done
     [ -n "${e:-}" ] || exit 1 ;;
esac

s="$e/script"
# Only run a regular file owned by this user, in a pool owned by this user
[ ! -L "$s" ] && [ -O "$s" ] && [ -O "$(dirname "$(dirname "$e")")" ] || { echo "gitpush: refusing $s (symlink or not owned by $USER)" >&2; exit 1; }
[ -x "$s" ] || { echo "gitpush: $s is not executable" >&2; exit 1; }
# Merges never go through gitpush: they are prepared for gitmerge
! grep -q 'pr merge' "$s" || { echo "gitpush: $s merges a PR, refusing (use gitmerge)" >&2; exit 1; }
echo "gitpush: ${e#*/.gitpool/} — $(head -1 "$e/message" 2>/dev/null)"
exec "$s"
