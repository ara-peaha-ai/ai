#!/usr/bin/env node
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const text = args.find((a) => !a.startsWith('-'));
const outIndex = args.indexOf('--out');
const output = outIndex !== -1 ? args[outIndex + 1] : null;

if (args.includes('--help') || args.includes('-h') || !text) {
  console.error('Usage: share-qr <text> [--out file.png]');
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

const qrArgs = output
  ? ['-o', output, '-s', '10', '-l', 'H', text]
  : ['-t', 'ANSIUTF8', '-l', 'H', text];

// ponytail: no shell involved (spawnSync array args), so $, @, #, quotes etc. in text pass through unescaped
const result = spawnSync('qrencode', qrArgs, { stdio: 'inherit' });

if (result.error) {
  console.error('❌ qrencode not found. Install with: sudo apt install qrencode');
  process.exit(1);
}
process.exit(result.status ?? 1);
