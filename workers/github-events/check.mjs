// Runnable check against a running Worker:
//   npx wrangler@4.75.0 dev --port 8799 --var WEBHOOK_SECRET:testsecret --var CLIENT_TOKEN:testtoken
//   node check.mjs [url]   env WEBHOOK_SECRET / CLIENT_TOKEN, default testsecret / testtoken
import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'

const base = process.argv[2] || 'http://localhost:8799'
const secret = process.env.WEBHOOK_SECRET || 'testsecret'
const token = process.env.CLIENT_TOKEN || 'testtoken'
const wsUrl = q => `${base.replace(/^http/, 'ws')}/ws${q}`
const run = randomUUID().slice(0, 8)
const repoA = `o/a-${run}`

const deliver = (event, payload, { sig, id = randomUUID() } = {}) => {
  const body = JSON.stringify(payload)
  return fetch(`${base}/webhook`, {
    method: 'POST',
    headers: { 'X-GitHub-Event': event, 'X-GitHub-Delivery': id, 'X-Hub-Signature-256': sig ?? `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` },
    body
  })
}
const pr = (repo, number) => ({ action: 'opened', number, repository: { full_name: repo }, sender: { login: 'x' }, pull_request: { title: 't', merged: false, head: { sha: 'abc' } } })
const open = (q, protocols = ['v1', token]) => new Promise((resolve, reject) => {
  const ws = new WebSocket(wsUrl(q), protocols)
  const got = []
  ws.onmessage = (e) => { const ev = JSON.parse(e.data); if (!ev.hello) got.push(ev) }
  ws.onopen = () => resolve({ ws, got })
  ws.onerror = () => reject(new Error('ws refused'))
})
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

// wrong signature and wrong token are refused
assert.equal((await deliver('pull_request', pr(repoA, 1), { sig: 'sha256=00' })).status, 401)
await assert.rejects(open('', ['v1', 'nope']))
await assert.rejects(open('', ['v1', '']))

// live, case-insensitive repo filter; check_run in progress dropped; a redelivery is stored once
const live = await open(`?repo=${repoA.toUpperCase()}`)
const id = randomUUID()
assert.equal((await deliver('pull_request', pr(repoA, 2), { id })).status, 200)
await deliver('pull_request', pr(repoA, 2), { id })
await deliver('pull_request', pr(`o/b-${run}`, 3))
await deliver('check_run', { action: 'created', repository: { full_name: repoA }, check_run: {} })
// issue comment vs PR comment, branch delete
await deliver('issue_comment', { action: 'created', repository: { full_name: repoA }, issue: { number: 4 }, comment: { author_association: 'OWNER', body: 'x' } })
await deliver('issue_comment', { action: 'created', repository: { full_name: repoA }, issue: { number: 5, pull_request: {} }, comment: { author_association: 'OWNER', body: 'x' } })
await deliver('push', { ref: 'refs/heads/gone', after: '0'.repeat(40), deleted: true, head_commit: null, repository: { full_name: repoA } })
await wait(400)
assert.deepEqual(live.got.map(e => e.event), ['pull_request', 'issue_comment', 'issue_comment', 'push'])
assert.equal(live.got[1].issue, 4)
assert.equal(live.got[1].pr, undefined)
assert.equal(live.got[2].pr, 5)
assert.equal(live.got[3].deleted, true)
assert.equal(live.got[3].sha, undefined)
live.ws.close()

// replay: since=<seq - 1> gets the missed event back
const first = live.got[0].seq
const replay = await open(`?repo=${repoA}&since=${first - 1}`)
await wait(300)
assert.equal(replay.got[0].seq, first)
replay.ws.close()

// a replay longer than 500 ends with a truncated frame, the rest comes on reconnect
const repoC = `o/c-${run}`
for (let i = 0; i < 501; i += 50) await Promise.all(Array.from({ length: Math.min(50, 501 - i) }, (_, k) => deliver('pull_request', pr(repoC, i + k))))
const long = await open(`?repo=${repoC}&since=0`)
await wait(1500)
assert.equal(long.got.length, 501)
assert.equal(long.got.at(-1).truncated, true)
long.ws.close()
const rest = await open(`?repo=${repoC}&since=${long.got.at(-2).seq}`)
await wait(300)
assert.equal(rest.got.length, 1)
rest.ws.close()

console.log('github-events: ok')
