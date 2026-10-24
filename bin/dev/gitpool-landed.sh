#!/usr/bin/env bash
# Says which agent-prepared pushes have landed, even days after they were prepared.
# The agent writes one record per prepared gitpush: ~/.peaha/gitpool-watch/<entry id>.watch with
#   repo=<absolute repo or worktree dir>
#   branch=<branch the script pushes>
#   subject=<first line of the commit message>
#   started=<epoch seconds when the entry was written>
# and deletes it once it has handled the landed push.
#   gitpool-landed          every record, landed or pending
#   gitpool-landed --hook   landed ones only, for the Claude Code SessionStart hook (prints nothing when none):
#                           only records of repos inside the session folder (or holding it), fixed fields only
#                           (no commit subject in model context), at most ~20 s of fetches
set -uo pipefail
shopt -s nullglob

dir="$HOME/.peaha/gitpool-watch"
hook=0
[ "${1:-}" = "--hook" ] && hook=1

cwd=
# the hook gets the session JSON on stdin; its cwd scopes the records
[ "$hook" = 1 ] && cwd=$(jq -r '.cwd // empty' 2>/dev/null)

landed=()
for f in "$dir"/*.watch; do
  # ponytail: serial fetches with a total cap; records past it wait for the next session
  [ "$hook" = 1 ] && [ "$SECONDS" -ge 20 ] && break
  id=$(basename "$f" .watch)
  repo=$(sed -n 's/^repo=//p' "$f")
  branch=$(sed -n 's/^branch=//p' "$f")
  subject=$(sed -n 's/^subject=//p' "$f")
  started=$(sed -n 's/^started=//p' "$f")
  if [ ! -d "$repo" ]; then
    [ "$hook" = 1 ] || echo "missing  $id: $repo is gone"
    continue
  fi
  if [ -n "$cwd" ]; then
    case "$repo/" in "$cwd"/*) ;; *) case "$cwd/" in "$repo"/*) ;; *) continue ;; esac ;; esac
  fi
  if ! git check-ref-format --branch "$branch" >/dev/null 2>&1; then
    [ "$hook" = 1 ] || echo "invalid  $id: branch '$branch'"
    continue
  fi
  # explicit refspec so origin/<branch> moves on any clone; a failed fetch is unknown, never landed or pending
  if ! timeout -k 2 8 git -C "$repo" fetch -q origin -- "+refs/heads/$branch:refs/remotes/origin/$branch" 2>/dev/null; then
    [ "$hook" = 1 ] || echo "unknown  $id: fetch failed for $(basename "$repo") $branch"
    continue
  fi
  # only commits made after the entry was written count, so an older commit with the same subject never matches;
  # grep reads all input (no -q): with pipefail an early exit would SIGPIPE git log and look like a miss
  if git -C "$repo" log "origin/$branch" ${started:+--since=@$started} --format=%s -50 2>/dev/null | grep -xF -- "$subject" >/dev/null; then
    if [ "$hook" = 1 ]; then landed+=("$id $(basename "$repo") $branch")
    else landed+=("$id $(basename "$repo") $branch: $subject"); fi
  elif [ "$hook" = 0 ]; then
    echo "pending  $id $(basename "$repo") $branch: $subject"
  fi
done

[ ${#landed[@]} -eq 0 ] && exit 0
[ "$hook" = 1 ] && echo "gitpool: pushes prepared by an agent landed. If one is yours (this session prepared it or works in that repo) and no watcher of yours already handled it, continue its prepare-gitpush flow from the push landing; the record in $dir/ goes away when that flow is finished:"
for l in "${landed[@]}"; do echo "landed   $l"; done
