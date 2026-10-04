#!/usr/bin/env bash
# Check out every remote branch of a GitHub repo into its own worktree folder:
#   <dir>/<name>                  main folder (keeps its current branch)
#   <dir>/<name>-<branch-slug>    one folder per other branch ("/" -> "-")
# usage: repo-split-branches --repo owner/name [--branch name] [--dir base]   (base defaults to $PWD)
set -euo pipefail

repo=""; branch=""; base="$PWD"
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) repo="$2"; shift 2 ;;
    --branch) branch="$2"; shift 2 ;;
    --dir) base="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done
[ -n "$repo" ] || { echo "usage: repo-split-branches --repo owner/name [--branch name] [--dir base]" >&2; exit 1; }

name="${repo#*/}"
main="$base/$name"
[ -d "$main/.git" ] || git clone "git@github.com:$repo.git" "$main"
git -C "$main" fetch -q --prune origin
current=$(git -C "$main" branch --show-current)

if [ -n "$branch" ]; then
  git -C "$main" show-ref -q --verify "refs/remotes/origin/$branch" || { echo "no branch origin/$branch" >&2; exit 1; }
  branches="$branch"
else
  branches=$(git -C "$main" for-each-ref --format='%(refname:lstrip=3)' refs/remotes/origin | grep -vx HEAD)
fi

printf '%s\n' "$branches" |
while read -r b; do
  [ "$b" = "$current" ] && continue
  dir="$base/$name-${b//\//-}"
  [ -e "$dir" ] && { echo "skip $b: $dir exists"; continue; }
  if git -C "$main" show-ref -q --verify "refs/heads/$b"; then
    git -C "$main" worktree add -q "$dir" "$b" || echo "skip $b: already checked out elsewhere"
  else
    git -C "$main" worktree add -q --track -b "$b" "$dir" "origin/$b"
  fi
done

git -C "$main" worktree list
