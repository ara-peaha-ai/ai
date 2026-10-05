#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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

const HEIC_EXT = new Set(['.heic', '.heif']);
const isHeicFile = (f) => HEIC_EXT.has(path.extname(f).toLowerCase());

// (input) -> [ [srcFile, outFile], ... ] — a folder converts every .heic/.heif
// inside it; a file becomes "<name>.jpg" next to itself.
const planJobs = (inputPath) => {
  if (fs.statSync(inputPath).isDirectory()) {
    return fs
      .readdirSync(inputPath)
      .filter(isHeicFile)
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
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'heic-to-jpg-selftest-'));
  fs.writeFileSync(path.join(d, 'b.heic'), '');
  assert.deepStrictEqual(planJobs(path.join(d, 'b.heic')), [
    [path.join(d, 'b.heic'), path.join(d, 'b.jpg')],
  ]);
  assert.strictEqual(isHeicFile('foo.HEIC'), true);
  assert.deepStrictEqual(planJobs(d), [[path.join(d, 'b.heic'), path.join(d, 'b.jpg')]]);
  fs.rmSync(d, { recursive: true });
  console.log('selftest ok (file + folder path plan)');
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h') || !(quality > 0 && quality <= 100)) {
  console.error(
    [
      'Usage: heic-to-jpg [--quality N] [--keep] [input]        (0 < N <= 100, default 92)',
      '',
      '  [input]          a .heic/.heif file, or a folder of them (processed in bulk) — defaults to "."',
      '  --quality <N>    JPEG output quality                              [92]',
      '  --keep           keep the original .heic/.heif file(s) instead of deleting them',
      '  --help / -h      print usage and exit',
      '',
      'Wraps ImageMagick `convert -auto-orient -quality N <in> <out.jpg>`.',
      '',
      'Output: <name>.jpg next to the input. By default the original .heic/.heif',
      'is deleted after a successful conversion — pass --keep to preserve it.',
    ].join('\n')
  );
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

if (fs.statSync(input).isFile() && !isHeicFile(input)) {
  console.error(`❌ not a .heic/.heif file: ${input}`);
  process.exit(1);
}

const jobs = planJobs(input);
if (jobs.length === 0) {
  console.error(`❌ no .heic/.heif files found in ${input}`);
  process.exit(1);
}

let failed = 0;
for (const [src, out] of jobs) {
  // never overwrite an existing .jpg (e.g. photo.webp + photo.heic, or a jpg already there)
  if (fs.existsSync(out)) {
    console.error(`⚠️  skip ${src}: ${out} already exists`);
    failed++;
    continue;
  }
  const r = spawnSync(
    'convert',
    [src, '-auto-orient', '-quality', String(quality), out],
    { stdio: 'inherit' }
  );
  if (r.error) {
    console.error('❌ ImageMagick not found. Install with: sudo apt install imagemagick');
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
