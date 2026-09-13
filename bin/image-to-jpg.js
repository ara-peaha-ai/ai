#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ponytail: one map, one place to extend — add a new format by adding an
// entry here (extension -> spawnSync args builder), nothing else changes.
const CONVERTERS = {
  '.webp': { bin: 'ffmpeg', install: 'sudo apt install ffmpeg', args: (src, out) => ['-y', '-i', src, out] },
  '.heic': { bin: 'convert', install: 'sudo apt install imagemagick', args: (src, out, q) => [src, '-auto-orient', '-quality', String(q), out] },
  '.heif': { bin: 'convert', install: 'sudo apt install imagemagick', args: (src, out, q) => [src, '-auto-orient', '-quality', String(q), out] },
};

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--quality']);

const getFlag = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const input = args.find(
  (a, i) => !a.startsWith('-') && !(i > 0 && VALUE_FLAGS.has(args[i - 1]))
) || '.';
const quality = Number(getFlag('--quality', '92'));
const keep = args.includes('--keep');

const isSupportedFile = (f) => Object.hasOwn(CONVERTERS, path.extname(f).toLowerCase());

// (input) -> [ [srcFile, outFile], ... ] — a folder converts every supported
// image inside it; a file becomes "<name>.jpg" next to itself.
const planJobs = (inputPath) => {
  if (fs.statSync(inputPath).isDirectory()) {
    return fs
      .readdirSync(inputPath)
      .filter(isSupportedFile)
      .map((name) => {
        const { name: base } = path.parse(name);
        return [path.join(inputPath, name), path.join(inputPath, `${base}.jpg`)];
      });
  }
  const { dir, name } = path.parse(inputPath);
  return [[inputPath, path.join(dir, `${name}.jpg`)]];
};

if (args.includes('--selftest')) {
  const assert = require('assert');
  const os = require('os');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'image-to-jpg-selftest-'));
  fs.writeFileSync(path.join(d, 'a.webp'), '');
  fs.writeFileSync(path.join(d, 'b.heic'), '');
  fs.writeFileSync(path.join(d, 'c.txt'), '');
  assert.deepStrictEqual(planJobs(path.join(d, 'a.webp')), [
    [path.join(d, 'a.webp'), path.join(d, 'a.jpg')],
  ]);
  assert.strictEqual(isSupportedFile('foo.HEIF'), true);
  assert.strictEqual(isSupportedFile('foo.png'), false);
  assert.deepStrictEqual(
    planJobs(d).sort(),
    [
      [path.join(d, 'a.webp'), path.join(d, 'a.jpg')],
      [path.join(d, 'b.heic'), path.join(d, 'b.jpg')],
    ].sort()
  );
  fs.rmSync(d, { recursive: true });
  console.log('selftest ok (file + folder path plan, mixed extensions)');
  process.exit(0);
}

const extList = Object.keys(CONVERTERS).join(', ');

if (args.includes('--help') || args.includes('-h') || !(quality > 0 && quality <= 100)) {
  console.error(
    [
      `Usage: image-to-jpg [--quality N] [--keep] [input]        (0 < N <= 100, default 92)`,
      '',
      `  [input]          an image file (${extList}), or a folder of them (bulk) — defaults to "."`,
      '  --quality <N>    JPEG output quality, ImageMagick-based formats only  [92]',
      '  --keep           keep the original file(s) instead of deleting them',
      '  --help / -h      print usage and exit',
      '',
      'One command for any of the supported source formats — same behaviour as',
      'the format-specific commands (webp-to-jpg, heic-to-jpg), just picked',
      'automatically from the file extension. New formats get added to the',
      'CONVERTERS map in bin/image-to-jpg.js.',
      '',
      'Output: <name>.jpg next to the input. By default the original is',
      'deleted after a successful conversion — pass --keep to preserve it.',
    ].join('\n')
  );
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

if (fs.statSync(input).isFile() && !isSupportedFile(input)) {
  console.error(`❌ unsupported extension (supported: ${extList}): ${input}`);
  process.exit(1);
}

const jobs = planJobs(input);
if (jobs.length === 0) {
  console.error(`❌ no supported images (${extList}) found in ${input}`);
  process.exit(1);
}

let failed = 0;
for (const [src, out] of jobs) {
  const conv = CONVERTERS[path.extname(src).toLowerCase()];
  const r = spawnSync(conv.bin, conv.args(src, out, quality), { stdio: 'inherit' });
  if (r.error) {
    console.error(`❌ ${conv.bin} not found. Install with: ${conv.install}`);
    process.exit(1);
  }
  if ((r.status ?? 1) !== 0) {
    failed++;
    continue;
  }
  console.log(`✅ ${out}`);
  if (!keep) fs.rmSync(src);
}

process.exit(failed ? 1 : 0);
