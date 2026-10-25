#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--ratio']);

const getFlag = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const positionals = args.filter(
  (a, i) => !a.startsWith('-') && !(i > 0 && VALUE_FLAGS.has(args[i - 1]))
);
const input = positionals[0];

// "16:9" -> [16, 9]; anything else (0, letters, > 5 digits) -> null
const parseRatio = (s) => {
  const m = /^(\d{1,5}):(\d{1,5})$/.exec(s || '');
  return m && +m[1] > 0 && +m[2] > 0 ? [+m[1], +m[2]] : null;
};

// Largest centered crop of exactly x:y: (x*k) by (y*k). For video k is even
// when x or y is odd, because yuv420 encoders need even sides. Images use
// exact=1, or crop would round odd sides down on 4:2:0 JPEGs.
const cropFilter = ([x, y], video) => {
  const m = video && (x % 2 || y % 2) ? 2 : 1;
  const k = `trunc(min(iw/${x},ih/${y})/${m})*${m}`;
  return `crop='${x}*${k}':'${y}*${k}'${video ? '' : ':exact=1'}`;
};

// Local file only: a downloaded hls/concat file can't make ffmpeg fetch URLs.
const SAFE_INPUT = ['-protocol_whitelist', 'file'];

// -pattern_type none: a '%' in the name is not an image2 sequence pattern
const ffprobe = (file, entries, extra = []) =>
  spawnSync(
    'ffprobe',
    ['-v', 'error', ...SAFE_INPUT, '-pattern_type', 'none', ...extra, '-select_streams', 'v:0',
      '-show_entries', entries, '-of', 'csv=p=0', file],
    { encoding: 'utf8' }
  );

// Decided by the container ffprobe reads, not by the extension: stills open as
// image2 or a *_pipe demuxer (png_pipe, jpeg_pipe, webp_pipe...); gif/apng
// count as images only with a single frame. Returns the demuxer for an image, null for a video.
const imageFormat = (file) => {
  const format = ffprobe(file, 'format=format_name').stdout.trim();
  if (/^(image2|\w+_pipe|jpeg_mpf)$/.test(format)) return format;
  if (!/^(gif|apng)$/.test(format)) return null;
  return ffprobe(file, 'stream=nb_read_packets', ['-count_packets']).stdout.trim() === '1' ? format : null;
};
const isImage = (file) => imageFormat(file) !== null;

const outputPath = (file, [x, y]) => {
  const { dir, name, ext } = path.parse(file);
  return path.join(dir, `${name}.${x}_${y}${ext}`);
};

// Images: same demuxer ffprobe picked, '%' literal on input (-pattern_type, image2 only)
// and on output (-update 1, image2 muxer only: gif/webp/apng have their own, already literal).
const crop = (file, ratio) => {
  const output = outputPath(file, ratio);
  const format = imageFormat(file);
  const update = /\.(gif|webp|apng)$/i.test(output) ? [] : ['-update', '1'];
  const ffArgs = format
    ? ['-f', format, ...(format === 'image2' ? ['-pattern_type', 'none'] : []), '-i', file,
      '-vf', cropFilter(ratio, false), '-frames:v', '1', ...update, '-q:v', '2']
    : ['-i', file, '-vf', cropFilter(ratio, true), '-c:a', 'copy'];
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...SAFE_INPUT, ...ffArgs, output], { stdio: 'inherit' });
  return { r, output };
};

if (args.includes('--selftest')) {
  const assert = require('assert');
  assert.deepStrictEqual(parseRatio('16:9'), [16, 9]);
  assert.strictEqual(parseRatio('16x9'), null);
  assert.strictEqual(parseRatio('0:1'), null);
  assert.strictEqual(parseRatio('123456:1'), null);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-ratio-selftest-'));
  try {
    const make = (file, ...lavfi) => {
      const r = spawnSync('ffmpeg', ['-v', 'error', ...lavfi, file]);
      assert.strictEqual(r.status, 0, `fixture ${file}: ${r.stderr}`);
      return file;
    };
    const src = (size, extra = '') => ['-f', 'lavfi', '-i', `testsrc=size=${size}${extra}`];
    const vid = make(path.join(d, 'a.vid.mp4'), ...src('1920x1080', ':duration=1'));
    const aud = make(path.join(d, 'c.mp4'), ...src('1280x720', ':duration=1'), '-f', 'lavfi', '-i', 'sine=duration=1', '-shortest');
    const img = make(path.join(d, 'b.png'), ...src('1001x777'), '-frames:v', '1');
    const jpg = make(path.join(d, 'odd.jpg'), ...src('1001x777'), '-frames:v', '1', '-pix_fmt', 'yuvj420p');
    const pct = make(path.join(d, '100%d.jpg'), ...src('640x480'), '-frames:v', '1', '-update', '1');
    const gif = make(path.join(d, 'still.gif'), ...src('640x480'), '-frames:v', '1');
    const anim = make(path.join(d, 'anim.gif'), ...src('320x240', ':duration=1'));
    assert.deepStrictEqual([vid, aud, img, pct, gif, anim].map(isImage), [false, false, true, true, true, false]);
    const size = (f) => ffprobe(f, 'stream=width,height').stdout.trim();
    // expected = (x*k, y*k), k = floor(min(w/x, h/y)), rounded down to even for odd x or y on video
    for (const [file, ratio, expected] of [
      [vid, '9:16', '594,1056'],
      [vid, '16:9', '1920,1080'],
      [aud, '9:16', '396,704'],
      [img, '1:1', '777,777'],
      [img, '4:3', '1000,750'],
      [jpg, '1:1', '777,777'],
      [pct, '3:4', '360,480'],
      [gif, '1:1', '480,480'],
    ]) {
      const { r, output } = crop(file, parseRatio(ratio));
      assert.strictEqual(r.status, 0, `crop ${file} ${ratio}`);
      assert.strictEqual(size(output), expected, `${path.basename(output)}: ${size(output)}`);
    }
    assert.ok(fs.existsSync(path.join(d, 'a.vid.9_16.mp4')));
    assert.ok(fs.existsSync(path.join(d, '100%d.3_4.jpg')));
    const streams = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', path.join(d, 'c.9_16.mp4')], { encoding: 'utf8' });
    assert.ok(streams.stdout.includes('audio'), 'audio kept');
  } finally {
    fs.rmSync(d, { recursive: true });
  }
  console.log('selftest ok (ratio parse, img/vid detection, exact crop sizes, % names, audio, output name)');
  process.exit(0);
}

const ratioArg = getFlag('--ratio');
const ratio = parseRatio(ratioArg);

if (args.includes('--help') || args.includes('-h') || !input || !ratio || positionals.length > 1) {
  if (ratioArg && !ratio) console.error(`❌ invalid ratio: ${ratioArg} (expected x:y, e.g. 16:9)\n`);
  if (positionals.length > 1) console.error('❌ one input file at a time\n');
  console.error(
    [
      'Usage: aspect-ratio --ratio <x:y> <input>   (image or video)',
      '',
      '  <input>          an image or a video file',
      '  --ratio <x:y>    target aspect ratio: 16:9, 9:16, 4:3, 3:4, 1:1 or any x:y',
      '                   (integers 1-99999)                                 [required]',
      '  --help / -h      print usage and exit',
      '',
      'Crops the largest centered area of exactly x:y, no scaling and no black bars.',
      'Image or video is detected with ffprobe, not from the file name.',
      'Videos are re-encoded (sides kept even), audio is copied.',
      '',
      'Output: <name>.<x>_<y>.<ext> next to the input, overwritten if it exists',
      '        (photo.jpg -> photo.16_9.jpg)',
    ].join('\n')
  );
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

if (!fs.existsSync(input) || !fs.statSync(input).isFile()) {
  console.error(`❌ not a file: ${input}`);
  process.exit(1);
}

// No video stream, or only a cover picture (mp3/m4a artwork) = not an image nor a video
const probe = ffprobe(input, 'stream=codec_type:stream_disposition=attached_pic');
if (probe.error) {
  console.error('❌ ffmpeg/ffprobe not found. Install with: sudo apt install ffmpeg');
  process.exit(1);
}
// Playlists (hls, dash, concat) would open other files: refused too
const playlist = /^(hls|dash|concat)$/.test(ffprobe(input, 'format=format_name').stdout.trim());
if (probe.status !== 0 || !probe.stdout.startsWith('video') || probe.stdout.trim().endsWith(',1') || playlist) {
  console.error(`❌ not an image or a video: ${input}`);
  process.exit(1);
}

const { r, output } = crop(input, ratio);
if ((r.status ?? 1) === 0) console.log(`✅ ${output}`);
process.exit(r.status ?? 1);
