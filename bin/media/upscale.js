#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--scale']);

const getFlag = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const input = args.find(
  (a, i) => !a.startsWith('-') && !(i > 0 && VALUE_FLAGS.has(args[i - 1]))
);
const scale = Number(getFlag('--scale', '2'));

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff']);
const isImageFile = (f) => IMAGE_EXT.has(path.extname(f).toLowerCase());

// (input, factor) -> [ [srcFile, outFile], ... ]
// a directory fans out to a sibling "<dir>@<N>x/" with the same file names;
// a file becomes "<name>@<N>x<ext>" next to itself.
const planJobs = (inputPath, factor) => {
  const t = `@${factor}x`;
  if (fs.statSync(inputPath).isDirectory()) {
    const outDir = inputPath.replace(/\/+$/, '') + t;
    return fs
      .readdirSync(inputPath)
      .filter(isImageFile)
      .map((name) => [path.join(inputPath, name), path.join(outDir, name)]);
  }
  const { dir, name, ext } = path.parse(inputPath);
  return [[inputPath, path.join(dir, `${name}${t}${ext}`)]];
};

if (args.includes('--selftest')) {
  const assert = require('assert');
  const os = require('os');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'upscale-selftest-'));
  fs.writeFileSync(path.join(d, 'b.png'), '');
  assert.deepStrictEqual(planJobs(path.join(d, 'b.png'), 2), [
    [path.join(d, 'b.png'), path.join(d, 'b@2x.png')],
  ]);
  assert.deepStrictEqual(planJobs(d, 3), [[path.join(d, 'b.png'), `${d}@3x/b.png`]]);
  fs.rmSync(d, { recursive: true });
  console.log('selftest ok (file + folder path plan)');
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h') || !input || !(scale > 1)) {
  console.error(
    [
      'Usage: upscale [--scale N] <input>        (N > 1, default 2)',
      '',
      '  <input>          an image file, or a folder of images (processed in bulk)',
      '  --scale <N>      resize factor, e.g. 2 doubles each side          [2]',
      '  --help / -h      print usage and exit',
      '',
      'Plain Lanczos resample in linear light + a light unsharp pass — more',
      'pixels, no invented detail. For a real ML upscale install',
      'realesrgan-ncnn-vulkan and run it instead.',
      '',
      'Output:',
      '  file   -> <name>@<N>x.<ext>  next to the input',
      '  folder -> <folder>@<N>x/     sibling folder, same file names',
    ].join('\n')
  );
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

if (fs.statSync(input).isFile() && !isImageFile(input)) {
  console.error(`❌ not an image: ${input}`);
  process.exit(1);
}

const jobs = planJobs(input, scale);
if (jobs.length === 0) {
  console.error(`❌ no images found in ${input}`);
  process.exit(1);
}

const percent = `${scale * 100}%`;
let failed = 0;
for (const [src, out] of jobs) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = spawnSync(
    'convert',
    [
      src,
      '-colorspace', 'RGB',
      '-filter', 'Lanczos',
      '-resize', percent,
      '-colorspace', 'sRGB',
      '-unsharp', '0x0.75+0.6+0.008',
      '-strip',
      out,
    ],
    { stdio: 'inherit' }
  );
  if (r.error) {
    console.error('❌ ImageMagick not found. Install with: sudo apt install imagemagick');
    process.exit(1);
  }
  if ((r.status ?? 1) !== 0) failed++;
  else console.log(`✅ ${out}`);
}

process.exit(failed ? 1 : 0);
