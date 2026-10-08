#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// formats ffmpeg decodes as still images out of the box; .heic needs image-to-jpg first
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv']);

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--duration', '--ratio', '--output']);

const getFlag = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const positionals = args.filter(
  (a, i) => !a.startsWith('-') && !(i > 0 && VALUE_FLAGS.has(args[i - 1]))
);
const duration = Number(getFlag('--duration', '3'));
const fill = args.includes('--fill');
const ratio = getFlag('--ratio', '1:1');

// "W:H" -> [width, height] with the short side at 1080 px and both even
// (libx264 + yuv420p need even dimensions); null when not a valid ratio.
const frameSize = (r) => {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(r);
  if (!m || !(Number(m[1]) > 0 && Number(m[2]) > 0)) return null;
  const [a, b] = [Number(m[1]), Number(m[2])];
  const long = (x) => Math.round((1080 * x) / Math.min(a, b) / 2) * 2;
  return [long(a), long(b)];
};

const ext = (f) => path.extname(f).toLowerCase();
const isVideo = (f) => VIDEO_EXT.has(ext(f));
const isMedia = (f) => IMAGE_EXT.has(ext(f)) || isVideo(f);

// (positionals) -> { files, defaultOutput } — no input or one folder = every
// image/video in that folder, natural-sorted (img2 before img10); otherwise
// the given files, in the given order.
const planInputs = (inputs) => {
  if (inputs.length === 0) inputs = ['.'];
  if (inputs.length === 1 && fs.existsSync(inputs[0]) && fs.statSync(inputs[0]).isDirectory()) {
    const dir = inputs[0];
    const files = fs
      .readdirSync(dir)
      .filter(isMedia)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((name) => path.join(dir, name));
    return { files, defaultOutput: path.join(dir, 'slideshow.mp4') };
  }
  return { files: inputs, defaultOutput: 'slideshow.mp4' };
};

// one input per file (images looped for `secs`, videos as they are), each
// framed to WxH, then joined with the concat filter (the concat demuxer breaks
// timestamps on ffmpeg 4.x when inputs differ in size). Always video-only:
// the audio of input videos is dropped.
const buildArgs = (files, secs, w, h, output, fill = false) => {
  const inputs = files.flatMap((f) => (isVideo(f) ? ['-i', f] : ['-loop', '1', '-t', String(secs), '-i', f]));
  // --fill: cover + center crop (images arrive pre-cropped by fillImages, so
  // this only crops videos); default: fit inside + black bars
  const frame = fill
    ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
    : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
  const chains = files.map((_, i) => `[${i}:v]${frame},setsar=1,fps=30,format=yuv420p[v${i}]`);
  const joined = `${files.map((_, i) => `[v${i}]`).join('')}concat=n=${files.length}:v=1:a=0[out]`;
  return [
    '-hide_banner', '-loglevel', 'error', '-stats', ...inputs,
    '-filter_complex', [...chains, joined].join(';'), '-map', '[out]',
    '-c:v', 'libx264', '-crf', '20', '-movflags', '+faststart', '-n', output,
  ];
};

// --fill pre-pass: every image cropped to exactly WxH around the region sharp's
// "attention" strategy scores highest (skin tone, saturation, luminance), after
// applying the EXIF orientation that ffmpeg 4.4 ignores. Videos are untouched.
// ponytail: heuristic, not detection — real face/body boxes are the #pri 3 todo in README.
const fillImages = async (files, w, h, tmpDir) => {
  const sharp = require('sharp');
  return Promise.all(files.map(async (f, i) => {
    if (isVideo(f)) return f;
    const out = path.join(tmpDir, `${i}.png`);
    await sharp(f).rotate().resize(w, h, { fit: 'cover', position: sharp.strategy.attention }).toFile(out);
    return out;
  }));
};

const selftest = async () => {
  const assert = require('assert');
  const sharp = require('sharp');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'slideshow-selftest-'));
  for (const f of ['img10.jpg', 'img2.PNG', 'clip.MP4', 'notes.txt', 'raw.heic']) fs.writeFileSync(path.join(d, f), '');
  assert.deepStrictEqual(planInputs([d]), {
    files: [path.join(d, 'clip.MP4'), path.join(d, 'img2.PNG'), path.join(d, 'img10.jpg')],
    defaultOutput: path.join(d, 'slideshow.mp4'),
  });
  assert.deepStrictEqual(planInputs(['b.jpg', 'a.mp4']).files, ['b.jpg', 'a.mp4']);
  assert.deepStrictEqual(frameSize('1:1'), [1080, 1080]);
  assert.deepStrictEqual(frameSize('16:9'), [1920, 1080]);
  assert.deepStrictEqual(frameSize('9:16'), [1080, 1920]);
  assert.deepStrictEqual(frameSize('4:3'), [1440, 1080]);
  assert.deepStrictEqual(frameSize('3:4'), [1080, 1440]);
  assert.strictEqual(frameSize('1080x1920'), null);
  assert.strictEqual(frameSize('0:1'), null);
  const graphOf = (built) => built[built.indexOf('-filter_complex') + 1];
  const built = buildArgs(['a.jpg', 'c.mp4'], 2, 1080, 1920, 'out.mp4');
  assert.deepStrictEqual(built.slice(4, 12), ['-loop', '1', '-t', '2', '-i', 'a.jpg', '-i', 'c.mp4']);
  assert.ok(graphOf(built).includes('force_original_aspect_ratio=decrease,pad=1080:1920'));
  assert.ok(graphOf(built).endsWith('[v0][v1]concat=n=2:v=1:a=0[out]'));
  assert.ok(graphOf(buildArgs(['a.jpg'], 2, 1080, 1920, 'out.mp4', true)).includes('force_original_aspect_ratio=increase,crop=1080:1920'));
  const wide = path.join(d, 'wide.png');
  await sharp({ create: { width: 400, height: 100, channels: 3, background: '#888' } }).toFile(wide);
  const [cropped] = await fillImages([wide], 90, 160, d);
  const { width, height } = await sharp(cropped).metadata();
  assert.deepStrictEqual([width, height], [90, 160]);
  fs.rmSync(d, { recursive: true });
  console.log('selftest ok (folder natural sort + filter, file order kept, ratio -> frame size, ffmpeg args, --fill crop)');
  return 0;
};

const main = async () => {
  const frame = frameSize(ratio);
  if (args.includes('--help') || args.includes('-h') || !(duration > 0) || !frame) {
    console.error(
      [
        'Usage: slideshow [--duration S] [--ratio W:H] [--fill] [--output out.mp4] [folder | file1 file2 ...]',
        '',
        '  (no input)        every image/video in the current folder, natural-sorted',
        '  <folder>          every image/video in that folder, natural-sorted',
        '  <file1 file2 ...> exactly these images/videos, in this order',
        '  --duration <S>    seconds per image; videos always play in full  [3]',
        '  --ratio <W:H>     aspect ratio, short side 1080 px: 1:1, 16:9, 9:16, 4:3, 3:4, ...  [1:1]',
        '                    everything is fitted + letterboxed inside it',
        '  --fill            fill the frame instead: images cropped around the subject',
        '                    (sharp attention), videos center-cropped',
        '  --output <path>   output mp4  [<folder>/slideshow.mp4, or ./slideshow.mp4 for files]',
        '  --help / -h       print usage and exit',
        '',
        `Images: ${[...IMAGE_EXT].join(', ')}. Convert .heic first with image-to-jpg.`,
        `Videos: ${[...VIDEO_EXT].join(', ')}, played in full. The output is always silent.`,
        'An existing output file is never overwritten.',
      ].join('\n')
    );
    return args.includes('--help') || args.includes('-h') ? 0 : 1;
  }

  const { files, defaultOutput } = planInputs(positionals);
  const output = getFlag('--output', defaultOutput);

  const bad = files.filter((f) => !isMedia(f) || !fs.existsSync(f));
  if (bad.length) {
    console.error(`❌ missing or unsupported file(s): ${bad.join(', ')}`);
    return 1;
  }
  if (files.length === 0) {
    console.error(`❌ no images (${[...IMAGE_EXT].join(', ')}) or videos (${[...VIDEO_EXT].join(', ')}) found`);
    return 1;
  }
  if (fs.existsSync(output)) {
    console.error(`❌ ${output} already exists — remove it or pass --output`);
    return 1;
  }

  const [w, h] = frame;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slideshow-'));
  try {
    const inputs = fill ? await fillImages(files, w, h, tmpDir) : files;
    const r = spawnSync('ffmpeg', buildArgs(inputs, duration, w, h, output, fill), { stdio: 'inherit' });
    if (r.error) throw new Error('ffmpeg not found. Install with: sudo apt install ffmpeg');
    if (r.status !== 0) return r.status ?? 1;
    const videos = files.filter(isVideo).length;
    console.log(`✅ ${output} (${files.length - videos} images × ${duration}s + ${videos} videos)`);
    return 0;
  } catch (e) {
    console.error(`❌ ${e.message}`);
    return 1;
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
};

(args.includes('--selftest') ? selftest : main)().then((code) => process.exit(code));
