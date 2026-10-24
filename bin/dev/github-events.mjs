#!/usr/bin/env node
// Prints the github-events Worker's events, one JSON line each, as they happen.
//   github-events [--repo <owner/name>] [--pr <n>] [--ref <refs/heads/branch>] [--since <seq>] [--once]
//   github-events --tip        print the last stored event seq and exit (a --since starting point)
// --once exits 0 after the first matching push that is not a branch delete: a background command
// that ends when the push lands. The caller still runs its own landed check on exit.
// --pr / --ref are exact matches (--pr also matches a check_run listing that PR).
// Reconnects on its own and resumes from the last event it got; exits 1 when it never gets
// connected (bad config, token or Worker down), so a caller can fall back to polling.
// Config: ~/.peaha/github-events.env (github-events-setup).
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const args = process.argv.slice(2)
if (args.includes('-h') || args.includes('--help')) {
  console.log('usage: github-events [--repo <owner/name>] [--pr <n>] [--ref <refs/heads/branch>] [--since <seq>] [--once] | --tip')
  process.exit(0)
}
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }

let conf
try {
  conf = Object.fromEntries(readFileSync(`${homedir()}/.peaha/github-events.env`, 'utf8')
    .split('\n').map(l => l.match(/^(\w+)="?(.*?)"?$/)).filter(Boolean).map(m => [m[1], m[2]]))
} catch {
  console.error('github-events: no ~/.peaha/github-events.env, run github-events-setup first')
  process.exit(1)
}

const repo = opt('--repo')
const pr = opt('--pr') && Number(opt('--pr'))
const ref = opt('--ref')
let since = opt('--since')
const once = args.includes('--once')
const tip = args.includes('--tip')
const wanted = ev => (!pr || ev.pr === pr || ev.prs?.includes(pr)) && (!ref || ev.ref === ref)
  // --once waits for a landing: only a push that adds commits ends it, never a branch delete
  && (!once || (ev.event === 'push' && ev.deleted !== true))

let connected = false
let failures = 0
const connect = () => {
  const q = new URLSearchParams({ ...(repo && { repo }), ...(since !== undefined && { since }) })
  const ws = new WebSocket(`${conf.GITHUB_EVENTS_URL.replace(/^http/, 'ws')}/ws?${q}`, ['v1', conf.CLIENT_TOKEN])
  ws.onmessage = (e) => {
    let ev
    try { ev = JSON.parse(e.data) } catch { return console.error('github-events: bad frame skipped') }
    // hello carries the last stored seq: resume point when no --since was given
    if (ev.hello) {
      // exit only once the line is written: a plain exit can drop it on a pipe
      if (tip) { process.stdout.write(`${ev.seq}\n`, () => process.exit(0)); return }
      connected = true; failures = 0; since ??= String(ev.seq); return
    }
    // replay cut by the Worker: reconnect at once from the last seq for the rest
    if (ev.truncated) { ws.onclose = ws.onerror = null; ws.close(); connect(); return }
    since = String(ev.seq)
    if (wanted(ev)) {
      if (once) { ws.onclose = ws.onerror = null; process.stdout.write(`${e.data}\n`, () => process.exit(0)); return }
      console.log(e.data)
    }
  }
  // a refused handshake fires only `error` in Node, a dropped socket `close`: retry once per socket
  let done = false
  const retry = (why) => {
    if (done) return
    done = true
    console.error(`github-events: ${why}, retrying in 5 s`)
    // ponytail: fixed 5 s retry, backoff if the Worker is ever down for long
    if (!connected && ++failures >= 3) {
      console.error('github-events: cannot connect, check ~/.peaha/github-events.env and the Worker')
      process.exit(1)
    }
    setTimeout(connect, 5000)
  }
  ws.onerror = e => retry(e.message || 'connection error')
  ws.onclose = e => retry(`disconnected (${e.code})`)
}
connect()
