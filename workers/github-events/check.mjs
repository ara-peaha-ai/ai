// Runnable check against a running Worker (default: `wrangler dev --port 8799` with the test vars):
//   node check.mjs [url]   env WEBHOOK_SECRET / CLIENT_TOKEN, default testsecret / testtoken
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

const base = process.argv[2] || 'http://localhost:8799'
const secret = process.env.WEBHOOK_SECRET || 'testsecret'
const token = process.env.CLIENT_TOKEN || 'testtoken'
const wsUrl = q => `${base.replace(/^http/, 'ws')}/ws${q}`

const deliver = (event, payload, sig) => {
  const body = JSON.stringify(payload)
  return fetch(`${base}/webhook`, {
    method: 'POST',
    headers: { 'X-GitHub-Event': event, 'X-Hub-Signature-256': sig ?? `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` },
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
assert.equal((await deliver('pull_request', pr('o/a', 1), 'sha256=00')).status, 401)
await assert.rejects(open('', ['v1', 'nope']))

// live: only the filtered repo reaches the socket, check_run in progress is dropped
const live = await open('?repo=o/a')
assert.equal((await deliver('pull_request', pr('o/a', 2))).status, 200)
await deliver('pull_request', pr('o/b', 3))
await deliver('check_run', { action: 'created', repository: { full_name: 'o/a' }, check_run: {} })
await wait(300)
assert.deepEqual(live.got.map(e => e.pr), [2])
assert.equal(live.got[0].event, 'pull_request')
live.ws.close()

// replay: a reconnect with since=<last seen - 1> gets the missed event back
const replay = await open(`?repo=o/a&since=${live.got[0].seq - 1}`)
await wait(300)
assert.deepEqual(replay.got.map(e => e.seq), [live.got[0].seq])
replay.ws.close()

console.log('github-events: ok')
