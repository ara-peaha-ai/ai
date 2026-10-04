#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('-')) || '.';
const keep = args.includes('--keep');

const isWebpFile = (f) => path.extname(f).toLowerCase() === '.webp';

// (input) -> [ [srcFile, outFile], ... ] — a folder converts every .webp
// inside it; a file becomes "<name>.jpg" next to itself.
const planJobs = (inputPath) => {
  if (fs.statSync(inputPath).isDirectory()) {
    return fs
      .readdirSync(inputPath)
      .filter(isWebpFile)
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
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'webp-to-jpg-selftest-'));
  fs.writeFileSync(path.join(d, 'b.webp'), '');
  assert.deepStrictEqual(planJobs(path.join(d, 'b.webp')), [
    [path.join(d, 'b.webp'), path.join(d, 'b.jpg')],
  ]);
  assert.strictEqual(isWebpFile('foo.WEBP'), true);
  assert.deepStrictEqual(planJobs(d), [[path.join(d, 'b.webp'), path.join(d, 'b.jpg')]]);
  fs.rmSync(d, { recursive: true });
  console.log('selftest ok (file + folder path plan)');
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.error(
    [
      'Usage: webp-to-jpg [--keep] [input]',
      '',
      '  [input]          a .webp file, or a folder of them (processed in bulk) — defaults to "."',
      '  --keep           keep the original .webp file(s) instead of deleting them',
      '  --help / -h      print usage and exit',
      '',
      'Wraps `ffmpeg -i <in> <out.jpg>`.',
      '',
      'Output: <name>.jpg next to the input. By default the original .webp is',
      'deleted after a successful conversion — pass --keep to preserve it.',
    ].join('\n')
  );
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

if (fs.statSync(input).isFile() && !isWebpFile(input)) {
  console.error(`❌ not a .webp file: ${input}`);
  process.exit(1);
}

const jobs = planJobs(input);
if (jobs.length === 0) {
  console.error(`❌ no .webp files found in ${input}`);
  process.exit(1);
}

let failed = 0;
for (const [src, out] of jobs) {
  const r = spawnSync('ffmpeg', ['-y', '-i', src, out], { stdio: 'inherit' });
  if (r.error) {
    console.error('❌ ffmpeg not found. Install with: sudo apt install ffmpeg');
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
