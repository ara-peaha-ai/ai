// merge-ready: decides whether a PR is ready to merge from its reviewers' verdicts,
// sets the `merge-ready` commit status and keeps one sticky PR comment up to date.
// Runs on GitHub Actions and Gitea Actions (same workflow file, same env vars);
// only the review-thread lookup differs (GitHub GraphQL vs Gitea REST `resolver`).
//
// Verdict sources (latest per reviewer wins):
// - Copilot review body: "🟢 Approval recommended" = pass, any other overview = fail,
//   "unable to review" (quota) = no verdict
// - Human reviews: APPROVED = pass, CHANGES_REQUESTED = fail
// - Marker comments from the repo owner or org members (Grok, Laya gate, any other reviewer/gate):
//   <!-- review: <name> verdict=pass|fail sha=<head sha> -->
// A fail on an older commit counts as addressed (no longer blocking, not a pass) once
// new commits are pushed and none of the PR's review threads is still unresolved.
// No Actions event fires on thread resolution, on other CI finishing, or (without
// manual approval) on the Copilot bot's review: re-run via workflow_dispatch, or post
// a marker comment (the Claude review pass does), which triggers issue_comment.
//
// Ready = at least one passing verdict on the head commit, no fail, no unresolved thread, every other
// commit status / check run green, and every REQUIRED_REVIEWERS name passing.
// Local dry run: GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY=owner/repo PR_NUMBER=23 DRY_RUN=1 node .github/scripts/merge-ready.mjs

import { readFileSync } from 'node:fs'

const env = process.env
const api = env.GITHUB_API_URL || 'https://api.github.com'
const isGitea = env.GITEA_ACTIONS === 'true'
const [owner, repo] = env.GITHUB_REPOSITORY.split('/')
const event = env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : {}
const prNumber = Number(env.PR_NUMBER || event.pull_request?.number || event.issue?.number)
const required = (env.REQUIRED_REVIEWERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
const dryRun = env.DRY_RUN === '1'
const CONTEXT = 'merge-ready'
const STICKY = '<!-- merge-ready -->'
// COLLABORATOR left out: it covers any access level, including read-only
const TRUSTED = ['OWNER', 'MEMBER']
const COPILOT = 'copilot-pull-request-reviewer[bot]'

const call = async (path, { method = 'GET', body } = {}) => {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: { Authorization: `token ${env.GITHUB_TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}
// Every page: GitHub caps per_page at 100, Gitea caps limit at 50; a short page is the last one
const list = async path => {
  const all = []
  for (let page = 1; ; page++) {
    const items = await call(`${path}${path.includes('?') ? '&' : '?'}per_page=100&limit=50&page=${page}`)
    all.push(...items)
    if (items.length < 50) return all
  }
}

const R = `/repos/${owner}/${repo}`

const unresolvedThreads = async () => {
  if (isGitea) {
    const reviews = await list(`${R}/pulls/${prNumber}/reviews`)
    const comments = (await Promise.all(reviews.map(r => list(`${R}/pulls/${prNumber}/reviews/${r.id}/comments`)))).flat()
    // ponytail: unverified on a real Gitea; if replies lack `resolver` this over-counts,
    // which blocks (never a false green) — fix when the first instance is up
    return comments.filter(c => !c.resolver).length
  }
  // ponytail: first 100 threads, cursor pagination if a PR ever gets past that
  const q = `query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved}}}}}`
  const graphql = api.endsWith('/api/v3') ? api.replace(/\/v3$/, '/graphql') : `${api}/graphql`
  const res = await fetch(graphql, {
    method: 'POST',
    headers: { Authorization: `bearer ${env.GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q, variables: { o: owner, r: repo, n: prNumber } })
  })
  const json = await res.json()
  if (json.errors) throw new Error(JSON.stringify(json.errors))
  return json.data.repository.pullRequest.reviewThreads.nodes.filter(t => !t.isResolved).length
}

const copilotVerdict = body => {
  if (/unable to review/i.test(body)) return null
  if (body.includes('Approval recommended')) return 'pass'
  return /Copilot review overview/.test(body) ? 'fail' : null
}

const MARKER = /<!--\s*review:\s*([\w.-]+)\s+verdict=(pass|fail)\s+sha=([0-9a-f]{7,40})\s*-->/i

const main = async () => {
  const pr = await call(`${R}/pulls/${prNumber}`)
  if (pr.state !== 'open') return console.log(`PR #${prNumber} is ${pr.state}, nothing to do`)
  const head = pr.head.sha

  const [reviews, comments, threads, combined, checkRuns] = await Promise.all([
    list(`${R}/pulls/${prNumber}/reviews`),
    list(`${R}/issues/${prNumber}/comments`),
    unresolvedThreads(),
    call(`${R}/commits/${head}/status`),
    isGitea ? { check_runs: [] } : call(`${R}/commits/${head}/check-runs?per_page=100`)
  ])

  // Latest verdict per reviewer, oldest → newest so later entries overwrite earlier ones
  const verdicts = new Map()
  // a null verdict (Copilot quota, dismissed review) clears the reviewer's older verdict: latest wins
  const add = (name, verdict, sha, at) => verdict ? verdicts.set(name.toLowerCase(), { name, verdict, sha, at }) : verdicts.delete(name.toLowerCase())
  const items = [
    ...reviews.map(r => ({ at: r.submitted_at, review: r })),
    // created_at, not updated_at: editing an old marker must not move it after a newer verdict
    ...comments.map(c => ({ at: c.created_at, comment: c }))
  ].sort((a, b) => new Date(a.at) - new Date(b.at))

  for (const { at, review, comment } of items) {
    if (review) {
      const login = review.user?.login ?? ''
      if (review.state === 'DISMISSED' || review.dismissed) add(login === COPILOT ? 'copilot' : login, null)
      else if (login === COPILOT) add('copilot', copilotVerdict(review.body ?? ''), review.commit_id, at)
      else if (review.state === 'APPROVED') add(login, 'pass', review.commit_id, at)
      else if (['CHANGES_REQUESTED', 'REQUEST_CHANGES'].includes(review.state)) add(login, 'fail', review.commit_id, at)
    } else {
      const m = comment.body?.match(MARKER)
      // ponytail: Gitea has no author_association, trust is the instance's own access control
      if (m && (isGitea || TRUSTED.includes(comment.author_association))) add(m[1], m[2].toLowerCase(), m[3], at)
    }
  }

  const sameSha = (a, b) => {
    if (!a || !b) return false
    const [x, y] = [a.toLowerCase(), b.toLowerCase()]
    return x.startsWith(y) || y.startsWith(x)
  }
  const rows = [...verdicts.values()].map(v => {
    const stale = v.sha && !sameSha(v.sha, head)
    // a pass counts only on the head commit; a fail on an older commit is addressed once fixes
    // are pushed and every thread is resolved
    const state = v.verdict === 'pass' ? (stale ? 'stale' : 'pass') : stale && threads === 0 ? 'addressed' : 'fail'
    return { ...v, stale, state }
  })
  // human CHANGES_REQUESTED stays blocking until re-reviewed, as on GitHub
  for (const r of rows) if (r.state === 'addressed' && reviews.some(x => x.user?.login?.toLowerCase() === r.name.toLowerCase() && ['CHANGES_REQUESTED', 'REQUEST_CHANGES'].includes(x.state))) r.state = 'fail'

  const otherChecks = [
    ...combined.statuses.filter(s => s.context !== CONTEXT).map(s => ({ name: s.context, state: s.state === 'success' ? 'ok' : s.state === 'pending' ? 'pending' : 'fail' })),
    ...checkRuns.check_runs.filter(c => c.name !== CONTEXT && c.name !== env.GITHUB_JOB).map(c => ({
      name: c.name,
      state: c.status !== 'completed' ? 'pending' : ['success', 'neutral', 'skipped'].includes(c.conclusion) ? 'ok' : 'fail'
    }))
  ]

  const blockers = []
  if (!rows.some(r => r.state === 'pass')) blockers.push('no passing review yet')
  for (const r of rows.filter(r => r.state === 'fail')) blockers.push(`${r.name}: changes requested`)
  if (threads) blockers.push(`${threads} unresolved review thread(s)`)
  for (const name of required) if (rows.find(r => r.name.toLowerCase() === name)?.state !== 'pass') blockers.push(`${name}: required verdict missing`)
  for (const c of otherChecks.filter(c => c.state === 'fail')) blockers.push(`check ${c.name} failed`)
  const pending = otherChecks.filter(c => c.state === 'pending')
  for (const c of pending) blockers.push(`check ${c.name} still running`)

  const ready = blockers.length === 0
  const status = ready ? 'success' : pending.length && blockers.length === pending.length ? 'pending' : 'failure'
  const description = ready ? 'Ready to merge' : blockers[0].slice(0, 140)

  const short = head.slice(0, 7)
  const body = [
    STICKY,
    ready ? `### ✅ Ready to merge (\`${short}\`)` : `### ⏳ Not ready to merge (\`${short}\`)`,
    '',
    '| Reviewer | Verdict | Commit |',
    '|---|---|---|',
    ...(rows.length ? rows.map(r => `| ${r.name} | ${r.state} | ${r.sha ? r.sha.slice(0, 7) : '—'}${r.stale ? ' (older)' : ''} |`) : ['| — | no verdict yet | — |']),
    '',
    ...(ready ? [] : ['**Missing:**', ...blockers.map(b => `- ${b}`)])
  ].join('\n')

  console.log(`${CONTEXT}: ${status} — ${description}\n\n${body}`)
  if (dryRun) return

  await call(`${R}/statuses/${head}`, { method: 'POST', body: { state: status, context: CONTEXT, description } })
  const sticky = comments.find(c => c.body?.startsWith(STICKY))
  if (sticky) await call(`${R}/issues/comments/${sticky.id}`, { method: 'PATCH', body: { body } })
  else await call(`${R}/issues/${prNumber}/comments`, { method: 'POST', body: { body } })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
