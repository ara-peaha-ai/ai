#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--text', '--position', '--fontsize', '--color', '--start', '--end']);

const getFlag = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

// positional input = first bare arg that isn't a flag or a flag's value
const input = args.find(
  (a, i) => !a.startsWith('-') && !(i > 0 && VALUE_FLAGS.has(args[i - 1]))
);

const text = getFlag('--text', process.env.TEXT_OVERLAY_TEXT);
const position = getFlag('--position', 'top'); // top | center | bottom
const fontsize = getFlag('--fontsize', '48');
const color = getFlag('--color', 'white');
const start = getFlag('--start', '0'); // video only, seconds
const end = getFlag('--end', ''); // video only, seconds; empty = whole clip

if (args.includes('--help') || args.includes('-h') || !input || !text) {
  console.error(
    [
      'Usage: text-overlay --text "your text" <input>   (image or video)',
      '',
      '  --text <string>      text to draw (or env TEXT_OVERLAY_TEXT)   [required]',
      '  --position <where>   top | center | bottom                    [top]',
      '  --fontsize <px>      font size in pixels                       [48]',
      '  --color <color>      font color (ffmpeg color name or #hex)    [white]',
      '  --start <seconds>    video: when the text appears              [0]',
      '  --end <seconds>      video: when the text disappears           [end of clip]',
      '',
      'Output: <input-name>-overlay.<ext> next to the input file.',
    ].join('\n')
  );
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

const yExpr = {
  top: 'h*0.06',
  center: '(h-text_h)/2',
  bottom: 'h-text_h-h*0.06',
}[position];

if (!yExpr) {
  console.error(`❌ --position must be top, center or bottom (got "${position}")`);
  process.exit(1);
}

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff']);
const { dir, name, ext } = path.parse(input);
const isImage = IMAGE_EXT.has(ext.toLowerCase());
const output = path.join(dir, `${name}-overlay${ext}`);

// Pass the text via a temp file with expansion disabled: no filtergraph
// escaping of colons/quotes/commas, and a literal '%' no longer aborts drawtext.
const textFile = path.join(os.tmpdir(), `text-overlay-${process.pid}.txt`);
fs.writeFileSync(textFile, text);

let filter =
  `drawtext=textfile='${textFile}':expansion=none` +
  `:font='Sans':fontsize=${fontsize}:fontcolor=${color}` +
  `:borderw=2:bordercolor=black` +
  `:x=(w-text_w)/2:y=${yExpr}`;

let ffmpegArgs;
if (isImage) {
  ffmpegArgs = ['-y', '-i', input, '-vf', filter, '-q:v', '2', output];
} else {
  // ponytail: video path keeps the original re-encode + drop-audio behavior
  filter += end
    ? `:enable='between(t,${start},${end})'`
    : start !== '0'
      ? `:enable='gte(t,${start})'`
      : '';
  ffmpegArgs = ['-y', '-i', input, '-vf', filter, '-c:v', 'libx264', '-crf', '18', '-an', output];
}

const result = spawnSync('ffmpeg', ffmpegArgs, { stdio: 'inherit' });
fs.unlinkSync(textFile);

if (result.error) {
  console.error('❌ ffmpeg not found. Install with: sudo apt install ffmpeg');
  process.exit(1);
}
if ((result.status ?? 1) === 0) console.log(`✅ ${output}`);
process.exit(result.status ?? 1);
