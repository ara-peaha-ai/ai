#!/usr/bin/env node
const { spawnSync } = require('child_process');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.error('Usage: search-string <string> [--case true|false] [--directory <path>]');
  console.error('  --case true|false   case-sensitive search (default: false)');
  console.error('  --directory <path>  directory to search (default: current directory)');
  process.exit(0);
}

const caseIndex = args.indexOf('--case');
const caseSensitive = caseIndex !== -1 && args[caseIndex + 1] === 'true';

const dirIndex = args.indexOf('--directory');
const rawDirectory = dirIndex !== -1 ? args[dirIndex + 1] : '.';
const directory = rawDirectory.startsWith('~')
  ? path.join(os.homedir(), rawDirectory.slice(1))
  : rawDirectory;

const consumed = new Set();
if (caseIndex > -1) { consumed.add(caseIndex); consumed.add(caseIndex + 1); }
if (dirIndex > -1) { consumed.add(dirIndex); consumed.add(dirIndex + 1); }
const query = args.find((a, i) => !consumed.has(i) && !a.startsWith('-'));

if (!query) {
  console.error('Usage: search-string <string> [--case true|false] [--directory <path>]');
  process.exit(1);
}

const EXCLUDES = ['.git', 'node_modules'];

console.log(`# Filenames matching "${query}" in ${directory}`);
const findArgs = [
  directory,
  ...EXCLUDES.flatMap((d) => ['-not', '-path', `*/${d}/*`]),
  caseSensitive ? '-name' : '-iname',
  `*${query}*`,
];

const nameResult = spawnSync('find', findArgs, { stdio: 'inherit' });
if (nameResult.error) {
  console.error('❌ find not found on PATH.');
  process.exit(1);
}

console.log(`\n# Content matches for "${query}" in ${directory}`);
const grepArgs = [
  '-r',
  '-n',
  '-I',
  ...(caseSensitive ? [] : ['-i']),
  ...EXCLUDES.map((d) => `--exclude-dir=${d}`),
  '--',
  query,
  directory,
];
const contentResult = spawnSync('grep', grepArgs, { stdio: 'inherit' });
if (contentResult.error) {
  console.error('❌ grep not found on PATH.');
  process.exit(1);
}
