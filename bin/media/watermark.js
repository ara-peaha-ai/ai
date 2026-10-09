#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv']);
const SUFFIX = '-watermark';
const MAX_TILE = 4096;

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--text', '--opacity', '--font-size', '--rotation', '--color']);

const getFlag = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const positionals = args.filter(
  (a, i) => !a.startsWith('-') && !(i > 0 && VALUE_FLAGS.has(args[i - 1]))
);
const text = getFlag('--text', null);
const opacity = Number(getFlag('--opacity', '0.25'));
const fontSize = Number(getFlag('--font-size', '36'));
const rotation = Number(getFlag('--rotation', '0'));
const color = getFlag('--color', 'black');
const recursive = args.includes('--recursive');

const ext = (f) => path.extname(f).toLowerCase();
const isImage = (f) => IMAGE_EXT.has(ext(f));
const isVideo = (f) => VIDEO_EXT.has(ext(f));
// our own outputs are skipped, so re-running on a folder never stacks watermarks
const isOutput = (f) => path.parse(f).name.endsWith(SUFFIX);

// named color, #hex or numeric rgb()/rgba() only: the value lands in an SVG
// attribute, so quotes, url(...) and anything else are rejected
const isSafeColor = (c) =>
  /^(#[0-9a-f]{3,8}|[a-z]+|rgba?\(\s*[\d.%]+(\s*,\s*[\d.%]+){2,3}\s*\))$/i.test(c);

const escapeXml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// (positionals) -> files: no input = current folder; a folder = its images and
// videos (subfolders only with --recursive); a file = itself
const planInputs = (inputs, deep) => {
  if (inputs.length === 0) inputs = ['.'];
  return inputs.flatMap((input) => {
    if (!fs.existsSync(input) || !fs.statSync(input).isDirectory()) return [input];
    return fs
      .readdirSync(input, { recursive: deep })
      .map((name) => path.join(input, name))
      .filter((f) => (isImage(f) || isVideo(f)) && !isOutput(f) && fs.statSync(f).isFile())
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  });
};

// one tile: the text centered and rotated, the tile sized to the rotated text's
// bounding box (min 256px) times `scale`. ponytail: text width estimated at
// 0.6em per char (no font metrics), plus a 1em gap; wide glyphs can still clip.
const tileSvg = (scale) => {
  const size = fontSize * scale;
  const rad = (rotation * Math.PI) / 180;
  const textW = text.length * size * 0.6 + size;
  const textH = size * 2.2;
  const w = Math.ceil(Math.max(256 * scale, Math.abs(textW * Math.cos(rad)) + Math.abs(textH * Math.sin(rad))));
  const h = Math.ceil(Math.max(256 * scale, Math.abs(textW * Math.sin(rad)) + Math.abs(textH * Math.cos(rad))));
  if (w > MAX_TILE || h > MAX_TILE) throw new Error(`watermark tile ${w}×${h}px is too big — shorten --text or lower --font-size`);
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <g transform="rotate(${rotation} ${w / 2} ${h / 2})">
        <text x="${w / 2}" y="${h / 2}" font-family="sans-serif" font-size="${size}"
          fill="${escapeXml(color)}" fill-opacity="${opacity}" text-anchor="middle" dominant-baseline="middle">${escapeXml(text)}</text>
      </g>
    </svg>`);
};

const outputOf = (input) => {
  const { dir, name, ext: e } = path.parse(input);
  return path.join(dir, `${name}${SUFFIX}${e}`);
};

// image: tile at native pixel size (font size = real px on the image)
const watermarkImage = (input, output) =>
  sharp(fs.readFileSync(input)).composite([{ input: tileSvg(1), tile: true }]).toFile(output);

// video: tile scaled with the frame (a 256px tile = 1/3 of the short side),
// overlaid on every frame; audio copied untouched
const watermarkVideo = async (input, output) => {
  const tmpFrame = path.join(os.tmpdir(), `wm-frame-${crypto.randomUUID()}.png`);
  const tmpOverlay = path.join(os.tmpdir(), `wm-overlay-${crypto.randomUUID()}.png`);
  try {
    const frame = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-frames:v', '1', tmpFrame], { stdio: 'inherit' });
    if (frame.error) throw new Error('ffmpeg not found. Install with: sudo apt install ffmpeg');
    if (frame.status !== 0) throw new Error(`ffmpeg could not read ${input}`);
    const { width, height } = await sharp(tmpFrame).metadata();
    await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: tileSvg(Math.min(width, height) / 768), tile: true }])
      .png()
      .toFile(tmpOverlay);
    const r = spawnSync(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-stats', '-i', input, '-i', tmpOverlay,
        '-filter_complex', '[0][1]overlay=0:0:format=auto', '-c:a', 'copy', '-movflags', 'faststart', output],
      { stdio: 'inherit' }
    );
    if (r.status !== 0) throw new Error(`ffmpeg failed (exit ${r.status ?? r.signal})`);
  } finally {
    fs.rmSync(tmpFrame, { force: true });
    fs.rmSync(tmpOverlay, { force: true });
  }
};

const usage = () =>
  console.error(
    [
      'Usage: watermark --text <string> [options] [file | folder ...]',
      '',
      '  (no input)          every image/video in the current folder',
      '  <folder>            every image/video in that folder',
      '  <file ...>          exactly these images/videos',
      '  --text <string>     watermark text                              [required]',
      '  --opacity <0-1>     text opacity                                [0.25]',
      '  --font-size <px>    font size (px on images; videos scale it)   [36]',
      '  --rotation <deg>    text rotation, negative = counter-clockwise [0]',
      "  --color <color>     name, '#hex' (quoted) or rgb()              [black]",
      '  --recursive         folders: include subfolders too',
      '  --help / -h         print usage and exit',
      '',
      `Images: ${[...IMAGE_EXT].join(', ')}. Videos: ${[...VIDEO_EXT].join(', ')}.`,
      `Output: <name>${SUFFIX}.<ext> next to each input. Files already named *${SUFFIX}.* are skipped.`,
    ].join('\n')
  );

const validate = () => {
  // a value flag as the last arg (e.g. `--color #fff` unquoted: bash drops the comment)
  const bare = [...VALUE_FLAGS].find((f) => args.includes(f) && args[args.indexOf(f) + 1] === undefined);
  if (bare) return `${bare} needs a value`;
  if (!text) return '--text is required';
  if (!(opacity >= 0 && opacity <= 1)) return `--opacity must be between 0 and 1 (got "${getFlag('--opacity', '')}")`;
  if (!(fontSize > 0 && fontSize <= 1000)) return `--font-size must be a number between 1 and 1000 (got "${getFlag('--font-size', '')}")`;
  if (!Number.isFinite(rotation)) return `--rotation must be a number of degrees (got "${getFlag('--rotation', '')}")`;
  if (!isSafeColor(color)) return `--color must be a color name, '#hex' or rgb() (got "${color}")`;
  return null;
};

const main = async () => {
  if (args.includes('--help') || args.includes('-h')) return usage(), 0;
  const error = validate();
  if (error) return console.error(`❌ ${error}\n`), usage(), 1;

  const files = planInputs(positionals, recursive);
  if (files.length === 0) return console.error('❌ no images or videos found'), 1;
  let failed = 0;
  for (const input of files) {
    try {
      if (!fs.existsSync(input)) throw new Error('file not found');
      const output = outputOf(input);
      if (isImage(input)) await watermarkImage(input, output);
      else if (isVideo(input)) await watermarkVideo(input, output);
      else throw new Error('not a supported image or video');
      console.log(output);
    } catch (e) {
      failed++;
      console.error(`❌ ${input}: ${e.message}`);
    }
  }
  return failed ? 1 : 0;
};

const selftest = async () => {
  const assert = require('assert');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'watermark-selftest-'));
  for (const f of ['b.jpg', 'a10.png', 'a2.mp4', `a2${SUFFIX}.mp4`, 'notes.txt', 'sub/c.jpg']) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), '');
  }
  const rel = (files) => files.map((f) => path.relative(d, f));
  assert.deepStrictEqual(rel(planInputs([d], false)), ['a2.mp4', 'a10.png', 'b.jpg']);
  assert.deepStrictEqual(rel(planInputs([d], true)), ['a2.mp4', 'a10.png', 'b.jpg', 'sub/c.jpg']);
  assert.deepStrictEqual(planInputs(['x.jpg', 'y.mp4'], false), ['x.jpg', 'y.mp4']);
  fs.rmSync(d, { recursive: true });

  for (const ok of ['black', 'white', '#4FB3E8', '#fff', 'rgb(1, 2, 3)', 'rgba(1,2,3,0.5)']) assert.ok(isSafeColor(ok), ok);
  for (const bad of ['red" font-size="400', 'url(https://x)', 'red blue', '', 'rgb(1)']) assert.ok(!isSafeColor(bad), bad);
  console.log('selftest ok (folder scan + --recursive + skip own outputs, file order kept, color allowlist)');
  return 0;
};

(args.includes('--selftest') ? selftest : main)().then((code) => process.exit(code));
