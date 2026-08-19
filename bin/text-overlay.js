#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('-'));

if (args.includes('--help') || args.includes('-h') || !input) {
  console.error('Usage: text-overlay <input.mp4>');
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

// ponytail: stub — always draws "hello world" at t=0-3s. Add
// --text/--start/--end flags once the real overlay requirements are known.
const { dir, name, ext } = path.parse(input);
const output = path.join(dir, `${name}-overlay${ext}`);

const filter =
  "drawtext=text='hello world':font='Sans':fontsize=40:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,0,3)'";

const result = spawnSync(
  'ffmpeg',
  ['-y', '-i', input, '-vf', filter, '-c:v', 'libx264', '-crf', '18', '-an', output],
  { stdio: 'inherit' }
);

if (result.error) {
  console.error('❌ ffmpeg not found. Install with: sudo apt install ffmpeg');
  process.exit(1);
}
process.exit(result.status ?? 1);
