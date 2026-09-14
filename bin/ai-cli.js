#!/usr/bin/env node

// `ai-cli doctor` — show which browser chatgpt-image would use right now.
if (process.argv[2] === 'doctor') {
  const path = require('path');
  try {
    process.loadEnvFile(path.join(__dirname, '..', '.env'));
  } catch {}
  const { resolveBrowser, isHeadlessBox } = require('./lib/browser');
  console.log(`headless host: ${isHeadlessBox() ? 'yes (no DISPLAY/WAYLAND)' : 'no'}`);
  try {
    const p = resolveBrowser();
    console.log(`browser      : ${p.mode === 'remote' ? 'remote — ' : 'local — '}${p.label}`);
  } catch (e) {
    console.log(`browser      : none — ${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}

const COMMANDS = [
  ['chatgpt-image', 'Upload an image to ChatGPT with a prompt, download the result'],
  ['instagram-download', 'Download a single Instagram reel, post, or photo'],
  ['instagram-download-batch', 'Download every post + story highlight from an Instagram profile'],
  ['tiktok-download', 'Download a single TikTok video or photo post'],
  ['tiktok-download-batch', 'Download every post from a TikTok profile'],
  ['x-download', 'Download a single X (Twitter) post\'s media'],
  ['x-download-batch', 'Download every media post from an X (Twitter) profile'],
  ['get-first-frame', 'Extract the first frame of a video as a JPEG'],
  ['get-last-frame', 'Extract the last frame of a video as a JPEG'],
  ['blur-video', 'Blur a video from a given second to the end'],
  ['text-overlay', 'Draw a line of text over an image or a video'],
  ['upscale', 'Resample an image (or a folder of images) up by an integer factor'],
  ['heic-to-jpg', 'Convert an iPhone .heic/.heif image (or a folder of them) to .jpg'],
  ['webp-to-jpg', 'Convert a .webp image (or a folder of them) to .jpg'],
  ['image-to-jpg', 'Convert any supported image format (.webp, .heic, .heif, ...) to .jpg'],
  ['select-best-photos', 'Pick the N best/most representative solo photos of one person from a folder'],
  ['share-qr', 'Print/save a QR code for arbitrary text'],
  ['search-string', 'Search file names + content for a string in a directory'],
  ['watermark-image', 'Tile a rotated diagonal text watermark over an image'],
  ['watermark-video', 'Tile a rotated diagonal text watermark over every frame of a video'],
  ['redact-faces', 'Blur/redact faces in an image or video via the Sightengine API'],
];

const width = Math.max(...COMMANDS.map(([name]) => name.length));

console.log('Usage: ai-cli --help | -h');
console.log('       <command> --help   (each command below is its own CLI, run it directly)');
console.log('');
console.log('Commands:');
for (const [name, desc] of COMMANDS) {
  console.log(`  ${name.padEnd(width)}  ${desc}`);
}
console.log('');
console.log('ai-cli doctor   Show which browser chatgpt-image would use');
console.log('Full docs: README.md');
