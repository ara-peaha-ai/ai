#!/usr/bin/env node
// Prints the github-events Worker's events, one JSON line each, as they happen.
//   github-events [--repo <owner/name>] [--since <seq>]
// Reconnects on its own and replays what it missed. Config: ~/.peaha/github-events.env (github-events-setup).
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const args = process.argv.slice(2)
if (args.includes('-h') || args.includes('--help')) {
  console.log('usage: github-events [--repo <owner/name>] [--since <seq>]')
  process.exit(0)
}
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }

let conf
try {
  conf = Object.fromEntries(readFileSync(`${homedir()}/.peaha/github-events.env`, 'utf8')
    .split('\n').map(l => l.match(/^(\w+)="?(.*?)"?$/)).filter(Boolean).map(m => [m[1], m[2]]))
} catch {
  console.error('no ~/.peaha/github-events.env: run github-events-setup first')
  process.exit(1)
}

const repo = opt('--repo')
let since = opt('--since')

const connect = () => {
  const q = new URLSearchParams({ ...(repo && { repo }), ...(since !== undefined && { since }) })
  const ws = new WebSocket(`${conf.GITHUB_EVENTS_URL.replace(/^http/, 'ws')}/ws?${q}`, ['v1', conf.CLIENT_TOKEN])
  ws.onmessage = (e) => {
    const ev = JSON.parse(e.data)
    // hello carries the last stored seq: resume point when no --since was given
    if (ev.hello) { since ??= String(ev.seq); return }
    since = String(ev.seq)
    console.log(e.data)
  }
  // ponytail: fixed 5 s retry, backoff if the Worker is ever down for long
  ws.onclose = () => setTimeout(connect, 5000)
}
connect()
