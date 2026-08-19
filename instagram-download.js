#!/usr/bin/env node
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('-'));

if (args.includes('--help') || args.includes('-h') || !url) {
  console.error('Usage: instagram-download <reel-or-post-url>');
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

// ponytail: gallery-dl, not yt-dlp — yt-dlp's Instagram extractors are
// currently broken upstream (both instagram:user and single-post video).
const FILENAME_FORMAT = '{username}-{date:%Y%m%dT%H%M%S}_{num}.{extension}';

const result = spawnSync('gallery-dl', ['--cookies-from-browser', 'chrome', '-D', '.', '-f', FILENAME_FORMAT, url], {
  stdio: 'inherit'
});

if (result.error) {
  console.error('❌ gallery-dl not found. Install with: pipx install gallery-dl');
  process.exit(1);
}
if (result.status !== 0) {
  console.error('❌ Download failed. If this keeps happening, log into instagram.com in Chrome and retry.');
}
process.exit(result.status ?? 1);
