// GitHub webhooks -> one-line events, kept for 30 days and streamed over a WebSocket,
// so an agent wakes on pushes, reviews, checks and comments instead of polling.
//   POST /webhook   GitHub delivery, HMAC-checked with WEBHOOK_SECRET, deduped on X-GitHub-Delivery
//   GET  /ws        WebSocket, subprotocols "v1, <CLIENT_TOKEN>"; ?since=<seq> replays missed
//                   events, ?repo=<owner/name> keeps one repo only (case-insensitive). The first frame
//                   is {"hello":true,"seq":<last stored>}; a replay cut at REPLAY_MAX ends with
//                   {"truncated":true}: the client reconnects from its last seq for the rest.
import { DurableObject } from 'cloudflare:workers'

const KEEP_MS = 30 * 24 * 3600 * 1000
const REPLAY_MAX = 500
const enc = new TextEncoder()

// an unset or empty secret never matches, so a Worker without its secrets refuses everything
const sameSecret = (a, b) => {
  if (!a || !b) return false
  const x = enc.encode(a)
  const y = enc.encode(b)
  return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y)
}

const hmacHex = async (secret, body) => {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// whitespace collapsed, first 200 chars: a hint only, read the full body with gh
const clip = (s, n = 200) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n)

// Only what wakes an agent; null = not worth an event
export const summarize = (event, p) => {
  const base = { event, action: p.action ?? '', repo: p.repository?.full_name, actor: p.sender?.login }
  switch (event) {
    case 'pull_request':
      return { ...base, pr: p.number, title: clip(p.pull_request.title), merged: p.pull_request.merged, sha: p.pull_request.head.sha }
    case 'pull_request_review':
      return { ...base, pr: p.pull_request.number, state: p.review.state, sha: p.review.commit_id, assoc: p.review.author_association, text: clip(p.review.body) }
    case 'pull_request_review_comment':
      return { ...base, pr: p.pull_request.number, path: p.comment.path, assoc: p.comment.author_association, text: clip(p.comment.body) }
    case 'pull_request_review_thread':
      return { ...base, pr: p.pull_request.number }
    case 'issue_comment':
      // issues and PRs share the event; only a PR comment carries `pr`
      return { ...base, ...(p.issue.pull_request ? { pr: p.issue.number } : { issue: p.issue.number }), assoc: p.comment.author_association, text: clip(p.comment.body) }
    case 'check_run':
      if (p.action !== 'completed') return null
      return { ...base, name: p.check_run.name, conclusion: p.check_run.conclusion, sha: p.check_run.head_sha, prs: p.check_run.pull_requests.map(x => x.number) }
    case 'status':
      return { ...base, name: p.context, state: p.state, sha: p.sha, text: clip(p.description) }
    case 'push':
      // a branch delete has no commit: no sha
      return { ...base, ref: p.ref, ...(p.deleted ? {} : { sha: p.after }), created: p.created, deleted: p.deleted, forced: p.forced, text: clip(p.head_commit?.message?.split('\n')[0]) }
    case 'workflow_run':
      if (p.action !== 'completed') return null
      return { ...base, name: p.workflow_run.name, conclusion: p.workflow_run.conclusion, sha: p.workflow_run.head_sha }
    case 'ping':
      return { ...base, text: clip(p.zen) }
    default:
      return base
  }
}

export class Events extends DurableObject {
  constructor (ctx, env) {
    super(ctx, env)
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, repo TEXT, line TEXT)')
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, ts INTEGER)')
  }

  add (ev, delivery) {
    const ts = Date.now()
    const sql = this.ctx.storage.sql
    // GitHub retries and "Redeliver" resend the same delivery id
    if (delivery && sql.exec('INSERT OR IGNORE INTO deliveries (id, ts) VALUES (?, ?)', delivery, ts).rowsWritten === 0) return
    const { seq } = sql.exec('INSERT INTO events (ts, repo, line) VALUES (?, ?, ?) RETURNING seq', ts, (ev.repo ?? '').toLowerCase(), '').one()
    const line = JSON.stringify({ seq, ts: new Date(ts).toISOString(), ...ev })
    sql.exec('UPDATE events SET line = ? WHERE seq = ?', line, seq)
    sql.exec('DELETE FROM events WHERE ts < ?', ts - KEEP_MS)
    sql.exec('DELETE FROM deliveries WHERE ts < ?', ts - KEEP_MS)
    for (const ws of this.ctx.getWebSockets()) {
      const { repo } = ws.deserializeAttachment() || {}
      if (repo && repo !== (ev.repo ?? '').toLowerCase()) continue
      // one dead socket must not stop the others
      try { ws.send(line) } catch {}
    }
  }

  async fetch (request) {
    const url = new URL(request.url)
    const repo = (url.searchParams.get('repo') || '').toLowerCase()
    const since = url.searchParams.get('since')
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ repo })
    const sql = this.ctx.storage.sql
    server.send(JSON.stringify({ hello: true, seq: sql.exec('SELECT COALESCE(MAX(seq), 0) AS seq FROM events').one().seq }))
    if (since !== null) {
      const rows = sql.exec('SELECT line FROM events WHERE seq > ? AND (? = \'\' OR lower(repo) = ?) ORDER BY seq LIMIT ?', Number(since) || 0, repo, repo, REPLAY_MAX).toArray()
      for (const r of rows) server.send(r.line)
      if (rows.length === REPLAY_MAX) server.send(JSON.stringify({ truncated: true }))
    }
    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'v1' } })
  }

  // hibernation API: clients only listen; the runtime completes the close handshake
  webSocketMessage () {}
}

export default {
  async fetch (request, env) {
    const url = new URL(request.url)
    const stub = env.EVENTS.get(env.EVENTS.idFromName('all'))

    if (url.pathname === '/webhook' && request.method === 'POST') {
      if (!env.WEBHOOK_SECRET) return new Response('not configured', { status: 503 })
      const body = await request.text()
      const sig = request.headers.get('X-Hub-Signature-256') || ''
      if (!sameSecret(sig, `sha256=${await hmacHex(env.WEBHOOK_SECRET, body)}`)) return new Response('bad signature', { status: 401 })
      const ev = summarize(request.headers.get('X-GitHub-Event') || 'unknown', JSON.parse(body))
      if (ev) await stub.add(ev, request.headers.get('X-GitHub-Delivery'))
      return new Response('ok')
    }

    if (url.pathname === '/ws' && request.headers.get('Upgrade') === 'websocket') {
      const protocols = (request.headers.get('Sec-WebSocket-Protocol') || '').split(',').map(s => s.trim())
      if (!protocols.includes('v1') || !protocols.some(p => sameSecret(p, env.CLIENT_TOKEN))) return new Response('unauthorized', { status: 401 })
      return stub.fetch(request)
    }

    return new Response('not found', { status: 404 })
  }
}
