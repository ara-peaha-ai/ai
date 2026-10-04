#!/usr/bin/env bash
# Reverse of repo-split-branches: fold every <dir>/<name>-* worktree back into <dir>/<name>.
# Uncommitted changes in a worktree are saved as a local "wip:" commit on that worktree's
# branch (not pushed), then the folder is removed. The branch stays in <dir>/<name>.
# ponytail: gitignored files (.env, node_modules) are not committed and are deleted with the folder.
# usage: repo-join-branches --repo owner/name [--dir base]   (base defaults to $PWD)
set -euo pipefail

repo=""; base="$PWD"
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) repo="$2"; shift 2 ;;
    --dir) base="$2"; shift 2 ;;
    -h|--help) sed -n '2,6p' "$0" | sed 's/^# //'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done
[ -n "$repo" ] || { echo "usage: repo-join-branches --repo owner/name [--dir base]" >&2; exit 1; }

name="${repo#*/}"
main="$(cd "$base/$name" && pwd -P)"
prefix="$(dirname "$main")/$name-"

git -C "$main" worktree list --porcelain |
  awk '/^worktree /{w=substr($0,10)} /^branch /{print w "\t" substr($0,19)}' |
while IFS=$'\t' read -r w b; do
  case "$(cd "$w" 2>/dev/null && pwd -P)" in "$prefix"*) ;; *) continue ;; esac
  if [ -n "$(git -C "$w" status --porcelain)" ]; then
    git -C "$w" add -A
    git -C "$w" commit -q -m "wip: uncommitted changes from $(basename "$w")"
    echo "$b: saved uncommitted changes as a local wip commit"
  fi
  ahead=$(git -C "$w" rev-list --count '@{u}..' 2>/dev/null || echo "no upstream")
  [ "$ahead" = 0 ] || echo "$b: not pushed ($ahead)"
  git -C "$main" worktree remove "$w" && echo "removed $w"
done

git -C "$main" worktree prune
git -C "$main" branch -vv
