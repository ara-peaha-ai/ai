#!/usr/bin/env node
// ai: one entry point for the toolbox. `ai <tool> <chat name>` opens (or resumes) a named chat;
// `local` runs the CPU tools of this repo. Every name accepts its shortest unique prefix (c, g, d, l, u, ...).
// v0 of the AI router: the target is picked by hand; routing decisions move to Laya later.
const fs = require('fs');
const path = require('path');
const util = require('util');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const HELP = ['-h', '--help'];

const usage = `Usage: ai <tool> [chat name...]
       ai <tool> -p <prompt...>
       ai local <command> [args...]

Tools (full name or any unique prefix):
  claude     "ai c <name>" opens the claude chat <name> of this folder, resuming it if it exists;
             "ai c" alone opens a new unnamed chat; "ai c -p <prompt>" is headless (claude -p)
  grok       "ai g <name>" resumes the grok chat titled <name> in this folder (grok -r);
             "ai g" alone opens a new chat; "ai g -p <prompt>" is headless (grok -p)
  deepseek   DeepSeek through NVIDIA's free API (needs NVIDIA_API_KEY), prompt only, no chats yet:
             "ai d <prompt>" = "ai d -p <prompt>"
  local      the CPU tools of this repo, e.g. "ai l u photo.jpg" = upscale
             "ai l" alone lists them; "ai l <command> --help" for each one

Piped stdin reaches the headless calls: git diff | ai c -p "review this"

Env (shell, else ${path.join(REPO, '.env')}; deepseek only):
  NVIDIA_API_KEY     key from build.nvidia.com
  AI_DEEPSEEK_MODEL  default: deepseek-ai/deepseek-v4.1-flash
  AI_TIMEOUT_MS      give up on a silent DeepSeek call after this long (default: 300000)`;

const fail = (message) => {
  console.error(`ai: ${message}`);
  process.exit(1);
};

// Exact name wins, else the only name starting with the query; null when none or ambiguous.
const pick = (query, names) => {
  if (names.includes(query)) return query;
  const found = names.filter((n) => n.startsWith(query));
  if (found.length === 1) return found[0];
  console.error(found.length
    ? `ai: "${query}" is ambiguous: ${found.join(', ')}`
    : `ai: unknown "${query}", one of: ${names.join(', ')}`);
  return null;
};

// Child exit code and signal become ours, so the shell sees what the tool did
const run = (cmd, args) => {
  const child = spawn(cmd, args, { stdio: 'inherit' });
  child.on('error', (err) => fail(`cannot start ${cmd}: ${err.message}`));
  child.on('exit', (code, signal) => (signal ? process.kill(process.pid, signal) : process.exit(code)));
};

// Only the DeepSeek keys come from the repo .env, and only when the shell leaves them empty:
// the rest of that file (other API keys) never reaches the spawned agents and tools.
const loadDeepSeekEnv = () => {
  let parsed = {};
  try {
    parsed = util.parseEnv(fs.readFileSync(path.join(REPO, '.env'), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') fail(`cannot read ${path.join(REPO, '.env')}: ${err.message}`);
  }
  for (const key of ['NVIDIA_API_KEY', 'AI_DEEPSEEK_MODEL', 'AI_TIMEOUT_MS']) {
    if (!process.env[key] && parsed[key]) process.env[key] = parsed[key];
  }
};

const runDeepSeek = async (prompt) => {
  loadDeepSeekEnv();
  if (!process.env.NVIDIA_API_KEY) fail(`NVIDIA_API_KEY is not set (shell env or ${path.join(REPO, '.env')})`);
  const { streamText } = require('ai');
  const { createOpenAICompatible } = require('@ai-sdk/openai-compatible');
  const nvidia = createOpenAICompatible({
    name: 'nvidia',
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKey: process.env.NVIDIA_API_KEY,
  });
  const timeout = Number(process.env.AI_TIMEOUT_MS) || 300000;
  const result = streamText({
    model: nvidia(process.env.AI_DEEPSEEK_MODEL || 'deepseek-ai/deepseek-v4.1-flash'),
    prompt,
    abortSignal: AbortSignal.timeout(timeout),
  });
  let text = '';
  let reasoning = '';
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      text += part.text;
      process.stdout.write(part.text);
    } else if (part.type === 'reasoning-delta') {
      reasoning += part.text;
    } else if (part.type === 'abort') {
      fail(`no answer within ${timeout / 1000}s (free tier busy?)`);
    } else if (part.type === 'error') {
      const err = part.error;
      fail(err?.name === 'TimeoutError' ? `no answer within ${timeout / 1000}s (free tier busy?)` : err?.message || String(err));
    }
  }
  // Some reasoning models put the whole reply in reasoning_content and leave content empty
  if (!text && reasoning) process.stdout.write(reasoning);
  if (!text && !reasoning) fail('empty answer');
  process.stdout.write('\n');
};

// ponytail: flat list from package.json "bin"; the planned reorg ("ai l git push" = gitpush) adds groups here
const runLocal = ([query, ...args]) => {
  const bins = require(path.join(REPO, 'package.json')).bin;
  const names = Object.keys(bins).filter((n) => !['ai', 'ai-cli'].includes(n)).sort();
  if (!query || HELP.includes(query)) {
    console.log(`ai local <command> [args...], any unique prefix works:\n  ${names.join('\n  ')}`);
    process.exit(0);
  }
  const name = pick(query, names);
  if (!name) process.exit(1);
  run(path.join(REPO, bins[name]), args);
};

const main = async () => {
  const [query, ...rest] = process.argv.slice(2);
  if (!query || HELP.includes(query)) {
    console.log(usage);
    process.exit(query ? 0 : 1);
  }
  const target = pick(query, ['claude', 'grok', 'deepseek', 'local']);
  if (!target) process.exit(1);
  if (target === 'local') return runLocal(rest);

  if (rest.length === 1 && HELP.includes(rest[0])) {
    console.log(usage);
    process.exit(0);
  }
  const headless = rest[0] === '-p' || target === 'deepseek';
  const words = rest[0] === '-p' ? rest.slice(1) : rest;
  if (headless) {
    const prompt = words.join(' ');
    if (!prompt) fail(`missing prompt\n\n${usage}`);
    if (target === 'deepseek') return runDeepSeek(prompt);
    return run(target, ['-p', prompt]);
  }
  const name = words.join(' ');
  if (!name) return run(target, []);
  if (target === 'claude') return run(path.join(REPO, 'bin', 'dev', 'gitchat.sh'), ['--name', name]);
  // ponytail: grok cannot title a new chat from its CLI, so a name only resumes; new titled grok chats come when grok can
  return run('grok', ['-r', name]);
};

main().catch((err) => fail(err.message || String(err)));
