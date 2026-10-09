#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// formats ffmpeg decodes as still images out of the box; .heic/.avif need image-to-jpg first
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
const recursive = args.includes('--recursive');
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
// image/video in that folder (subfolders only when `deep`), natural-sorted
// (img2 before img10); otherwise the given files, in the given order.
const planInputs = (inputs, deep = false) => {
  if (inputs.length === 0) inputs = ['.'];
  if (inputs.length === 1 && fs.existsSync(inputs[0]) && fs.statSync(inputs[0]).isDirectory()) {
    const dir = inputs[0];
    const files = fs
      .readdirSync(dir, { recursive: deep })
      .filter((name) => isMedia(name) && fs.statSync(path.join(dir, name)).isFile())
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((name) => path.join(dir, name));
    return { files, defaultOutput: path.join(dir, 'slideshow.mp4') };
  }
  return { files: inputs, defaultOutput: 'slideshow.mp4' };
};

// One ffmpeg run per file (image looped for `secs`, video as it is), framed
// to WxH with identical encoder settings, so the segments can be joined with
// the concat demuxer as a stream copy. One input at a time keeps memory flat:
// a single filter graph with every input open grew to GBs on a few dozen
// photos. Always video-only: the audio of input videos is dropped.
const segmentArgs = (file, secs, w, h, fill, out) => {
  // --fill: cover + center crop (images arrive pre-cropped by prepareImages, so
  // this only crops videos); default: fit inside + black bars
  // every segment converted to and tagged as BT.709 limited range: the concat
  // copy keeps the first segment's tags for the whole file, so they must match
  const bt709 = 'out_color_matrix=bt709:out_range=tv';
  const frame = fill
    ? `scale=${w}:${h}:force_original_aspect_ratio=increase:${bt709},crop=${w}:${h}`
    : `scale=${w}:${h}:force_original_aspect_ratio=decrease:${bt709},pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
  // stills are read at 1 fps (decoded ~30x less often) and trimmed back to
  // the exact duration, since a 1 fps input can only end on whole seconds
  const video = isVideo(file);
  return [
    '-hide_banner', '-loglevel', 'error',
    ...(video ? ['-i', file] : ['-framerate', '1', '-loop', '1', '-t', String(Math.ceil(secs)), '-i', file]),
    '-vf', `${frame},setsar=1,fps=30${video ? '' : `,trim=duration=${secs}`},format=yuv420p`, '-an',
    '-c:v', 'libx264', '-crf', '20',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-video_track_timescale', '15360', '-n', out,
  ];
};

const concatArgs = (listFile, output) => [
  '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
  '-c', 'copy', '-movflags', '+faststart', '-n', output,
];

// concat demuxer list; paths are quoted for the demuxer's own syntax
const concatList = (segments) => segments.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n') + '\n';

const ffmpeg = (argv) => {
  const r = spawnSync('ffmpeg', argv, { stdio: 'inherit' });
  if (r.error) throw new Error('ffmpeg not found. Install with: sudo apt install ffmpeg');
  if (r.status !== 0 || interrupted) throw new Error(interrupted ? 'interrupted' : `ffmpeg failed (exit ${r.status ?? r.signal})`);
};

// Ctrl+C / kill: ffmpeg gets the signal too and exits on its own; this flag
// stops the image pre-pass, so main's cleanup (temp dir, partial output) runs.
let interrupted = false;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { interrupted = true; });

// Image pre-pass with sharp, one image at a time (bounded memory on big
// folders), written as PNG into tmpDir:
// - always: apply the EXIF orientation, which ffmpeg 4.4 ignores. Images
//   without an orientation tag go to ffmpeg untouched when not filling;
// - --fill: crop to exactly WxH around the people and faces found on CPU
//   (bin/lib/subject-crop.js); with nobody found, sharp's "attention"
//   heuristic picks the crop instead.
const prepareImages = async (files, w, h, tmpDir, fill) => {
  const sharp = require('sharp');
  const { detect, subjectCrop, releaseModels } = require('../lib/subject-crop');
  const out = [];
  for (const [i, f] of files.entries()) {
    if (interrupted) throw new Error('interrupted');
    if (isVideo(f)) { out.push(f); continue; }
    const { orientation } = await sharp(f).metadata();
    if (!fill && !(orientation > 1)) { out.push(f); continue; }
    const target = path.join(tmpDir, `${i}.png`);
    if (!fill) {
      await sharp(f).rotate().toFile(target);
      out.push(target);
      continue;
    }
    const { data, info } = await sharp(f).rotate().toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const raw = { raw: { width: info.width, height: info.height, channels: 3 } };
    const crop = subjectCrop(info.width, info.height, w, h, await detect(sharp, { data, width: info.width, height: info.height }));
    if (!crop) console.error(`↪ nobody found in ${f}, attention crop`);
    await (crop
      ? sharp(data, raw).extract(crop).resize(w, h)
      : sharp(data, raw).resize(w, h, { fit: 'cover', position: sharp.strategy.attention })
    ).toFile(target);
    out.push(target);
  }
  await releaseModels();
  return out;
};

const selftest = async () => {
  const assert = require('assert');
  const sharp = require('sharp');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'slideshow-selftest-'));
  for (const f of ['img10.jpg', 'img2.PNG', 'clip.MP4', 'notes.txt', 'raw.heic']) fs.writeFileSync(path.join(d, f), '');
  fs.mkdirSync(path.join(d, 'sub'));
  fs.writeFileSync(path.join(d, 'sub', 'img3.jpg'), '');
  assert.deepStrictEqual(planInputs([d]), {
    files: [path.join(d, 'clip.MP4'), path.join(d, 'img2.PNG'), path.join(d, 'img10.jpg')],
    defaultOutput: path.join(d, 'slideshow.mp4'),
  });
  assert.deepStrictEqual(planInputs([d], true).files.map((f) => path.relative(d, f)), ['clip.MP4', 'img2.PNG', 'img10.jpg', 'sub/img3.jpg']);
  assert.deepStrictEqual(planInputs(['b.jpg', 'a.mp4']).files, ['b.jpg', 'a.mp4']);
  assert.deepStrictEqual(frameSize('1:1'), [1080, 1080]);
  assert.deepStrictEqual(frameSize('16:9'), [1920, 1080]);
  assert.deepStrictEqual(frameSize('9:16'), [1080, 1920]);
  assert.deepStrictEqual(frameSize('4:3'), [1440, 1080]);
  assert.deepStrictEqual(frameSize('3:4'), [1080, 1440]);
  assert.strictEqual(frameSize('1080x1920'), null);
  assert.strictEqual(frameSize('0:1'), null);
  const img = segmentArgs('a.jpg', 2, 1080, 1920, false, 's0.mp4');
  assert.deepStrictEqual(img.slice(3, 11), ['-framerate', '1', '-loop', '1', '-t', '2', '-i', 'a.jpg']);
  assert.ok(img[img.indexOf('-vf') + 1].includes('fps=30,trim=duration=2,'));
  const frac = segmentArgs('a.jpg', 2.5, 1080, 1920, false, 's0.mp4');
  assert.strictEqual(frac[frac.indexOf('-t') + 1], '3');
  assert.ok(frac[frac.indexOf('-vf') + 1].includes('trim=duration=2.5,'));
  assert.ok(/^scale=1080:1920:force_original_aspect_ratio=decrease:out_color_matrix=bt709:out_range=tv,pad=1080:1920/.test(img[img.indexOf('-vf') + 1]));
  const vid = segmentArgs('c.mp4', 2, 1080, 1920, true, 's1.mp4');
  assert.deepStrictEqual(vid.slice(3, 5), ['-i', 'c.mp4']);
  assert.ok(!vid[vid.indexOf('-vf') + 1].includes('trim'));
  assert.ok(/^scale=1080:1920:force_original_aspect_ratio=increase:out_color_matrix=bt709:out_range=tv,crop=1080:1920/.test(vid[vid.indexOf('-vf') + 1]));
  assert.strictEqual(concatList(['/t/0.mp4', "/t/it's.mp4"]), "file '/t/0.mp4'\nfile '/t/it'\\''s.mp4'\n");
  // pure checks first: they need no model download and no network
  const { subjectCrop, decodeYolox, decodeYunet } = require('../lib/subject-crop');
  const box = (x1, y1, x2, y2) => ({ x1, y1, x2, y2, score: 1 });
  assert.strictEqual(subjectCrop(1600, 900, 9, 16, { persons: [], faces: [] }), null);
  // wide photo, vertical output: window centered on the person
  assert.deepStrictEqual(subjectCrop(1600, 900, 9, 16, { persons: [box(1100, 100, 1300, 900)], faces: [box(1150, 120, 1250, 230)] }),
    { left: 947, top: 0, width: 506, height: 900 });
  // two faces too far apart: the biggest one and its person win
  assert.deepStrictEqual(subjectCrop(1600, 900, 9, 16, {
    persons: [box(0, 100, 400, 900), box(1100, 100, 1500, 900)],
    faces: [box(100, 150, 200, 260), box(1200, 120, 1360, 300)],
  }), { left: 1047, top: 0, width: 506, height: 900 });
  // tall photo, wide output, body taller than the window: face near the top
  assert.deepStrictEqual(subjectCrop(900, 1600, 16, 9, { persons: [box(200, 300, 700, 1600)], faces: [box(380, 350, 520, 520)] }),
    { left: 0, top: 310, width: 900, height: 506 });
  // background crowd smaller than 30% of the main person is ignored
  assert.deepStrictEqual(subjectCrop(1600, 900, 1, 1, { persons: [box(100, 0, 600, 900), box(1500, 700, 1550, 800)], faces: [] }),
    { left: 0, top: 0, width: 900, height: 900 });
  // a big face outside every person (blurred background) does not move the crop
  assert.deepStrictEqual(subjectCrop(1600, 900, 9, 16, {
    persons: [box(1100, 100, 1300, 900)],
    faces: [box(1150, 120, 1250, 230), box(100, 100, 300, 300)],
  }), { left: 947, top: 0, width: 506, height: 900 });
  // decoders: one hand-made grid cell each, expected box in image pixels
  const yolo = new Float32Array(3549 * 85);
  yolo.set([0.5, 0.5, Math.log(2), Math.log(4), 0.9, 0.9]);
  const [p] = decodeYolox(yolo, 416, 0.5);
  assert.deepStrictEqual([p.x1, p.y1, p.x2, p.y2].map((v) => +v.toFixed(3)), [-8, -24, 24, 40]);
  const grid = (n, k) => ({ data: new Float32Array(n * k) });
  const yunet = Object.fromEntries([8, 16, 32].flatMap((st) => {
    const n = (64 / st) ** 2;
    return [[`cls_${st}`, grid(n, 1)], [`obj_${st}`, grid(n, 1)], [`bbox_${st}`, grid(n, 4)]];
  }));
  yunet.cls_16.data[5] = 0.9;
  yunet.obj_16.data[5] = 0.9;
  yunet.bbox_16.data.set([0.5, 0.5, Math.log(2), Math.log(2)], 5 * 4);
  const [fc] = decodeYunet(yunet, 64, 1);
  assert.deepStrictEqual([fc.x1, fc.y1, fc.x2, fc.y2].map((v) => +v.toFixed(3)), [8, 8, 40, 40]);
  const wide = path.join(d, 'wide.png');
  await sharp({ create: { width: 400, height: 100, channels: 3, background: '#888' } }).toFile(wide);
  const [cropped] = await prepareImages([wide], 90, 160, d, true);
  const { width, height } = await sharp(cropped).metadata();
  assert.deepStrictEqual([width, height], [90, 160]);
  const rotated = path.join(d, 'rotated.jpg');
  await sharp({ create: { width: 400, height: 100, channels: 3, background: '#888' } }).jpeg().withMetadata({ orientation: 6 }).toFile(rotated);
  const [upright, plain] = await prepareImages([rotated, wide], 1080, 1080, d, false);
  const meta = await sharp(upright).metadata();
  assert.deepStrictEqual([meta.width, meta.height], [100, 400]);
  assert.strictEqual(plain, wide);
  fs.rmSync(d, { recursive: true });
  console.log('selftest ok (folder natural sort + filter + --recursive, file order kept, ratio -> frame size, ffmpeg segment/concat args, subject crop geometry, decoders, --fill crop, EXIF orientation)');
  return 0;
};

const main = async () => {
  const frame = frameSize(ratio);
  const help = args.includes('--help') || args.includes('-h');
  if (!help && !(duration > 0)) console.error(`❌ --duration must be a positive number of seconds (got "${getFlag('--duration', '')}")`);
  if (!help && !frame) console.error(`❌ --ratio must be W:H, e.g. 1:1, 16:9, 9:16 (got "${ratio}")`);
  if (help || !(duration > 0) || !frame) {
    console.error(
      [
        'Usage: slideshow [--duration S] [--ratio W:H] [--fill] [--recursive] [--output out.mp4] [folder | file1 file2 ...]',
        '',
        '  (no input)        every image/video in the current folder, natural-sorted',
        '  <folder>          every image/video in that folder, natural-sorted',
        '  <file1 file2 ...> exactly these images/videos, in this order',
        '  --duration <S>    seconds per image; videos always play in full  [3]',
        '  --ratio <W:H>     aspect ratio, short side 1080 px: 1:1, 16:9, 9:16, 4:3, 3:4, ...  [1:1]',
        '                    default framing: fitted inside it + black bars',
        '  --fill            fill the frame instead: images cropped around the people and faces',
        '                    found on CPU (models downloaded once, ~20 MB), videos center-cropped',
        '  --recursive       folder input: include subfolders too',
        '  --output <path>   output mp4  [<folder>/slideshow.mp4, or ./slideshow.mp4 for files]',
        '  --help / -h       print usage and exit',
        '',
        `Images: ${[...IMAGE_EXT].join(', ')}. Convert .heic/.avif first with image-to-jpg --keep.`,
        `Videos: ${[...VIDEO_EXT].join(', ')}, played in full. The output is always silent.`,
        'An existing output file is never overwritten.',
      ].join('\n')
    );
    return help ? 0 : 1;
  }

  const [w, h] = frame;
  let tmpDir = null;
  let output = null; // set only once we know the file did not exist before this run
  try {
    const { files, defaultOutput } = planInputs(positionals, recursive);
    const target = getFlag('--output', defaultOutput);

    const bad = files.filter((f) => !isMedia(f) || !fs.existsSync(f));
    if (bad.length) throw new Error(`missing or unsupported file(s): ${bad.join(', ')}`);
    if (files.length === 0) {
      throw new Error(`no images (${[...IMAGE_EXT].join(', ')}) or videos (${[...VIDEO_EXT].join(', ')}) found`);
    }
    if (fs.existsSync(target)) throw new Error(`${target} already exists — remove it or pass --output`);
    output = target;

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slideshow-'));
    const inputs = await prepareImages(files, w, h, tmpDir, fill);
    const segments = inputs.map((f, i) => {
      console.error(`[${i + 1}/${inputs.length}] ${files[i]}`);
      const seg = path.join(tmpDir, `seg${i}.mp4`);
      ffmpeg(segmentArgs(f, duration, w, h, fill, seg));
      return seg;
    });
    const listFile = path.join(tmpDir, 'list.txt');
    fs.writeFileSync(listFile, concatList(segments));
    ffmpeg(concatArgs(listFile, output));
    const videos = files.filter(isVideo).length;
    console.log(`✅ ${output} (${files.length - videos} images × ${duration}s + ${videos} videos)`);
    output = null;
    return 0;
  } catch (e) {
    console.error(`❌ ${e.message}`);
    return 1;
  } finally {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true });
    // a failed or interrupted run never leaves a half-written mp4 behind
    if (output) fs.rmSync(output, { force: true });
  }
};

(args.includes('--selftest') ? selftest : main)().then((code) => process.exit(code));
