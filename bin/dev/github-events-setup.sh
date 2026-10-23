#!/usr/bin/env bash
# Deploy the github-events Worker and point GitHub webhooks at it. Safe to re-run.
#   github-events-setup.sh <owner> [<owner>...]   org: one org webhook; user: one webhook per own repo
#   github-events-setup.sh                         owners saved last time, else your user + the orgs you admin
# Needs: wrangler logged in (CLOUDFLARE_ACCOUNT_ID when the login has several accounts),
# gh logged in with admin:org_hook (`gh auth refresh -s admin:org_hook`).
# Writes ~/.peaha/github-events.env (mode 600): GITHUB_EVENTS_URL, CLIENT_TOKEN, WEBHOOK_SECRET, GITHUB_EVENTS_OWNERS.
set -euo pipefail

conf="$HOME/.peaha/github-events.env"
worker="$(cd "$(dirname "$(readlink -f "$0")")/../../workers/github-events" && pwd)"
wrangler=(npx --yes wrangler@4.75.0)
events='["pull_request","pull_request_review","pull_request_review_comment","pull_request_review_thread","issue_comment","check_run","status","push","workflow_run"]'

mkdir -p "$HOME/.peaha"
# shellcheck disable=SC1090
[ -f "$conf" ] && . "$conf"
owners=("$@")
[ ${#owners[@]} -gt 0 ] || read -r -a owners <<< "${GITHUB_EVENTS_OWNERS:-}"
[ ${#owners[@]} -gt 0 ] || read -r -a owners <<< "$(gh api user --jq .login) $(gh api user/memberships/orgs --jq '[.[] | select(.role == "admin") | .organization.login] | join(" ")')"
WEBHOOK_SECRET="${WEBHOOK_SECRET:-$(openssl rand -hex 32)}"
CLIENT_TOKEN="${CLIENT_TOKEN:-$(openssl rand -hex 32)}"

cd "$worker"
# -m1: grep stops itself, no SIGPIPE under pipefail; the Worker refuses everything until its secrets exist
url=$("${wrangler[@]}" deploy 2>&1 | tee /dev/stderr | grep -m1 -oE 'https://github-events\.[a-z0-9-]+\.workers\.dev' || true)
[ -n "$url" ] || { echo "deploy did not print a workers.dev URL" >&2; exit 1; }
printf '%s' "$WEBHOOK_SECRET" | "${wrangler[@]}" secret put WEBHOOK_SECRET >/dev/null
printf '%s' "$CLIENT_TOKEN" | "${wrangler[@]}" secret put CLIENT_TOKEN >/dev/null
# saved before the webhooks, so a failed run keeps the secrets the Worker already has
(umask 077; printf 'GITHUB_EVENTS_URL=%s\nCLIENT_TOKEN=%s\nWEBHOOK_SECRET=%s\nGITHUB_EVENTS_OWNERS="%s"\n' \
  "$url" "$CLIENT_TOKEN" "$WEBHOOK_SECRET" "${owners[*]}" > "$conf")

# create the hook, or update the one already pointing at this Worker
hook () { # $1 = API path of the hooks list (orgs/<org>/hooks or repos/<owner>/<repo>/hooks)
  local id body
  id=$(gh api "$1" --paginate --jq ".[] | select(.config.url == \"$url/webhook\") | .id" | sed -n 1p)
  # the secret goes through the environment, not jq's argv (visible in the process list)
  body=$(WEBHOOK_SECRET="$WEBHOOK_SECRET" jq -n --arg u "$url/webhook" --argjson e "$events" \
    '{name: "web", active: true, events: $e, config: {url: $u, content_type: "json", secret: env.WEBHOOK_SECRET, insecure_ssl: "0"}}')
  if [ -n "$id" ]; then gh api -X PATCH "$1/$id" --input - <<< "$body" >/dev/null; echo "updated $1/$id"
  else gh api -X POST "$1" --input - <<< "$body" --jq '"created '"$1"'/" + (.id|tostring)'; fi
}

me=$(gh api user --jq .login)
for o in "${owners[@]}"; do
  if [ "$(gh api "users/$o" --jq .type)" = Organization ]; then hook "orgs/$o/hooks"
  else
    # forks and archived (read-only) repos get no webhook; one failing repo does not stop the rest
    while read -r r; do hook "repos/$r/hooks" || echo "skipped repos/$r" >&2; done < <(gh api "$( [ "${o,,}" = "${me,,}" ] && echo "user/repos?affiliation=owner" || echo "users/$o/repos?type=owner")&per_page=100" --paginate --jq '.[] | select((.fork or .archived) | not) | .full_name')
  fi
done

echo "ok: $url, config in $conf"
