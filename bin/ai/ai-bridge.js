#!/usr/bin/env node
// ai-bridge: HTTP door to the JSON-in/JSON-out `ai` commands, so callers that can only speak HTTP
// (os on Cloudflare Pages through a tunnel, or next to it on the VPS Docker network) reach them.
// POST /<command> with a Bearer token: the body goes to `ai <command>` on stdin, its stdout comes back.
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const util = require('util');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const AI = path.join(__dirname, 'ai.js');
// Only commands with a JSON stdin/stdout contract belong here
const COMMANDS = ['ats'];
const MAX_BODY = 1024 * 1024;

if (['-h', '--help'].includes(process.argv[2])) {
  console.log(`Usage: ai-bridge

POST /<command> (${COMMANDS.join(', ')}) with "Authorization: Bearer $AI_CLI_TOKEN" and a JSON body:
the body is piped to "ai <command>", 200 + its JSON stdout, or 502 + {"error"} when it fails.

Env (shell, else ${path.join(REPO, '.env')}):
  AI_CLI_TOKEN      required, shared with the callers (e.g. os's NUXT_AI_CLI_TOKEN)
  AI_BRIDGE_HOST    default: 127.0.0.1; set 0.0.0.0 explicitly inside a container
  AI_BRIDGE_PORT    default: 4011
  plus the keys of each command, read by "ai" itself`);
  process.exit(0);
}

let fileEnv = {};
try {
  fileEnv = util.parseEnv(fs.readFileSync(path.join(REPO, '.env'), 'utf8'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}
const env = (key, fallback) => process.env[key] || fileEnv[key] || fallback;

const token = env('AI_CLI_TOKEN');
if (!token) {
  console.error('ai-bridge: AI_CLI_TOKEN is not set, refusing to start');
  process.exit(1);
}
// Hashing first gives equal lengths, which timingSafeEqual needs
const digest = (value) => crypto.createHash('sha256').update(value).digest();
const authorized = (header = '') => crypto.timingSafeEqual(digest(header), digest(`Bearer ${token}`));

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

// ponytail: one child process per request, no queue; add a concurrency cap if the VPS CPU suffers
const runCommand = (command, input, res) => new Promise((resolve) => {
  // The token stays in the bridge: the child loads only the keys of its command
  const { AI_CLI_TOKEN, ...childEnv } = process.env;
  const child = spawn(process.execPath, [AI, command], { env: childEnv });
  let stdout = '';
  let stderr = '';
  // Decoding per stream, not per chunk, keeps multibyte characters split across chunks whole
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  // EPIPE when the child dies before reading stdin: its exit code already reports the failure
  child.stdin.on('error', () => {});
  child.on('error', (err) => resolve({ code: 1, stdout: '', stderr: err.message }));
  child.on('close', (code) => resolve({ code, stdout, stderr }));
  // The caller left: stop the model call instead of paying for an answer nobody reads
  res.on('close', () => { if (!res.writableFinished) child.kill(); });
  child.stdin.end(input);
});

http.createServer((req, res) => {
  // Auth first, so an unauthenticated caller cannot tell which commands exist
  if (!authorized(req.headers.authorization)) return send(res, 401, { error: 'unauthorized' });
  const command = req.url.slice(1);
  if (req.method !== 'POST' || !COMMANDS.includes(command)) return send(res, 404, { error: 'not found' });

  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size <= MAX_BODY) chunks.push(chunk);
  });
  req.on('end', async () => {
    if (size > MAX_BODY) return send(res, 413, { error: 'body too large' });
    const { code, stdout, stderr } = await runCommand(command, Buffer.concat(chunks), res);
    if (res.destroyed) return;
    if (code === 0) return send(res, 200, stdout);
    send(res, 502, { error: stderr.replace(/\x1b\[[0-9;]*m/g, '').trim() || `ai ${command} exited with ${code}` });
  });
}).listen(Number(env('AI_BRIDGE_PORT', 4011)), env('AI_BRIDGE_HOST', '127.0.0.1'), function () {
  const { address, port } = this.address();
  console.log(`ai-bridge: listening on ${address}:${port}, commands: ${COMMANDS.join(', ')}`);
});
