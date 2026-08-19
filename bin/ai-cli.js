#!/usr/bin/env node

const COMMANDS = [
  ['chatgpt-image', 'Upload an image to ChatGPT with a prompt, download the result'],
  ['instagram-download', 'Download a single Instagram reel, post, or photo'],
  ['instagram-download-batch', 'Download every post + story highlight from an Instagram profile'],
  ['tiktok-download', 'Download a single TikTok video or photo post'],
  ['tiktok-download-batch', 'Download every post from a TikTok profile'],
  ['get-first-frame', 'Extract the first frame of a video as a JPEG'],
  ['get-last-frame', 'Extract the last frame of a video as a JPEG'],
  ['blur-video', 'Blur a video from a given second to the end'],
  ['text-overlay', 'Draw text overlay on a video (placeholder/stub)'],
  ['share-qr', 'Print/save a QR code for arbitrary text'],
  ['search-string', 'Search file names + content for a string in a directory'],
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
console.log('Full docs: README.md');
