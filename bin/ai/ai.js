#!/usr/bin/env node
// ai: one entry point for the toolbox. Remote models (claude, grok, deepseek) answer a prompt;
// `local` runs the CPU tools of this repo. Every name accepts any unique prefix (c, g, d, l, u, ...).
// v0 of the AI router: the target is picked by hand; routing decisions move to Laya later.
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..', '..');

const usage = `Usage: ai <target> <prompt...>
       ai local <command> [args...]

Targets (full name or any unique prefix):
  claude     Claude Code, headless (claude -p)
  grok       Grok, headless (grok -p)
  deepseek   DeepSeek through NVIDIA's free API (needs NVIDIA_API_KEY)
  local      the CPU tools of this repo, e.g. "ai l u photo.jpg" = upscale
             "ai l" alone lists them; "ai l <command> --help" for each one

Env (shell or the repo .env):
  NVIDIA_API_KEY     key from build.nvidia.com
  AI_DEEPSEEK_MODEL  default: deepseek-ai/deepseek-v4.1-flash`;

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

const run = (cmd, args, stdin = 'inherit') => {
  const child = spawn(cmd, args, { stdio: [stdin, 'inherit', 'inherit'] });
  child.on('error', (err) => {
    console.error(`ai: cannot start ${cmd}: ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code) => process.exit(code ?? 1));
};

const runDeepSeek = async (prompt) => {
  const { streamText } = require('ai');
  const { createOpenAICompatible } = require('@ai-sdk/openai-compatible');
  if (!process.env.NVIDIA_API_KEY) {
    console.error('ai: NVIDIA_API_KEY is not set (shell env or the repo .env)');
    process.exit(1);
  }
  const nvidia = createOpenAICompatible({
    name: 'nvidia',
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKey: process.env.NVIDIA_API_KEY,
  });
  const result = streamText({
    model: nvidia(process.env.AI_DEEPSEEK_MODEL || 'deepseek-ai/deepseek-v4.1-flash'),
    prompt,
    onError: ({ error }) => {
      console.error(`ai: ${error.message || error}`);
      process.exitCode = 1;
    },
  });
  for await (const text of result.textStream) process.stdout.write(text);
  process.stdout.write('\n');
};

// ponytail: flat list from package.json "bin"; the planned reorg ("ai l git push" = gitpush) adds groups here
const runLocal = ([query, ...args]) => {
  const bins = require(path.join(REPO, 'package.json')).bin;
  const names = Object.keys(bins).filter((n) => !['ai', 'ai-cli'].includes(n)).sort();
  if (!query) {
    console.log(`ai local <command> [args...], any unique prefix works:\n  ${names.join('\n  ')}`);
    process.exit(0);
  }
  const name = pick(query, names);
  if (!name) process.exit(1);
  run(path.join(REPO, bins[name]), args);
};

const main = () => {
  const [query, ...rest] = process.argv.slice(2);
  if (!query || query === '-h' || query === '--help') {
    console.log(usage);
    process.exit(query ? 0 : 1);
  }
  const target = pick(query, ['claude', 'grok', 'deepseek', 'local']);
  if (!target) process.exit(1);
  try {
    process.loadEnvFile(path.join(REPO, '.env'));
  } catch {}
  if (target === 'local') return runLocal(rest);

  const prompt = rest.join(' ');
  if (!prompt) {
    console.error(`ai: missing prompt\n\n${usage}`);
    process.exit(1);
  }
  if (target === 'deepseek') return runDeepSeek(prompt);
  // Headless CLIs wait for piped stdin when it is not a TTY: give them none
  return run(target, ['-p', prompt], 'ignore');
};

main();
