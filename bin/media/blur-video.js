#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const atIndex = args.indexOf('--at');
const at = atIndex !== -1 ? Number(args[atIndex + 1]) : NaN;
// ponytail: skip the --at value slot so a positional coming after the flag
// (e.g. `--at 19 ./input.mp4`, as shown in the usage line) isn't mistaken
// for it — args.find() alone would grab "19" instead of the file path
const input = args.find((a, i) => !a.startsWith('-') && i !== atIndex + 1);

if (args.includes('--help') || args.includes('-h') || !input || Number.isNaN(at)) {
  console.error('Usage: blur-video --at <seconds> <input.mp4>');
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

// ponytail: fade length hardcoded from the original 19->23 example; expose
// as --ramp if a different fade duration is ever needed.
const RAMP = 4;

const { dir, name, ext } = path.parse(input);
const output = path.join(dir, `${name}-blurred${ext}`);

const filter = `boxblur=25:1:enable='between(t,${at},${at + RAMP})',boxblur=50:1:enable='gte(t,${at + RAMP})'`;

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
