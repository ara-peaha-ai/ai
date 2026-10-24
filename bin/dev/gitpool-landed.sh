#!/usr/bin/env bash
# Says which agent-prepared pushes have landed, even days after they were prepared.
# The agent writes one record per prepared gitpush: ~/.peaha/gitpool-watch/<entry id>.watch with
#   repo=<absolute repo or worktree dir>
#   branch=<branch the script pushes>
#   subject=<first line of the commit message>
# and deletes it once it has handled the landed push.
#   gitpool-landed          every record, landed or pending
#   gitpool-landed --hook   landed ones only, for the Claude Code SessionStart hook (prints nothing when none)
set -uo pipefail
shopt -s nullglob

dir="$HOME/.peaha/gitpool-watch"
hook=0
[ "${1:-}" = "--hook" ] && hook=1

landed=()
for f in "$dir"/*.watch; do
  id=$(basename "$f" .watch)
  repo=$(sed -n 's/^repo=//p' "$f")
  branch=$(sed -n 's/^branch=//p' "$f")
  subject=$(sed -n 's/^subject=//p' "$f")
  if [ ! -d "$repo" ]; then
    [ "$hook" = 1 ] || echo "missing  $id: $repo is gone"
    continue
  fi
  timeout 15 git -C "$repo" fetch -q origin "$branch" 2>/dev/null
  # grep reads all input (no -q): with pipefail an early exit would SIGPIPE git log and look like a miss
  if git -C "$repo" log "origin/$branch" --format=%s -50 2>/dev/null | grep -xF -- "$subject" >/dev/null; then
    landed+=("$id $(basename "$repo") $branch: $subject")
  elif [ "$hook" = 0 ]; then
    echo "pending  $id $(basename "$repo") $branch: $subject"
  fi
done

[ ${#landed[@]} -eq 0 ] && exit 0
[ "$hook" = 1 ] && echo "gitpool: pushes prepared by an agent landed while no session was watching. Continue each one's prepare-gitpush flow from the push landing, then delete its record in $dir/:"
for l in "${landed[@]}"; do echo "landed   $l"; done
