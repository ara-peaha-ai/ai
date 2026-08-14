#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('-'));

if (args.includes('--help') || args.includes('-h') || !input) {
  console.error('Usage: get-last-frame <input.mp4>');
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

const { dir, name } = path.parse(input);
const output = path.join(dir, `${name}-last-frame.jpg`);

const result = spawnSync(
  'ffmpeg',
  ['-y', '-sseof', '-3', '-i', input, '-update', '1', '-q:v', '2', output],
  { stdio: 'inherit' }
);

if (result.error) {
  console.error('❌ ffmpeg not found. Install with: sudo apt install ffmpeg');
  process.exit(1);
}
process.exit(result.status ?? 1);
