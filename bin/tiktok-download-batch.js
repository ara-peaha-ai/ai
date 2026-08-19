#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('-'));

if (args.includes('--help') || args.includes('-h') || !target) {
  console.error('Usage: tiktok-download-batch <username-or-profile-url>');
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

const username = target.replace(/^https?:\/\/(www\.)?tiktok\.com\/@/, '').replace(/\/.*$/, '');
const profileUrl = `https://www.tiktok.com/@${username}`;

const OUTPUT_DIR = 'tiktok';
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const FILENAME_FORMAT = '{user}-{date:%Y%m%dT%H%M%S}_{num}.{extension}';

// --download-archive skips posts already downloaded on a rerun, which is
// the whole point of hitting a profile repeatedly over time. Shared across
// all profiles in OUTPUT_DIR since gallery-dl keys entries by post id.
const result = spawnSync(
  'gallery-dl',
  [
    '--cookies-from-browser', 'chrome',
    '-D', OUTPUT_DIR,
    '-f', FILENAME_FORMAT,
    '--download-archive', `${OUTPUT_DIR}/.downloaded.sqlite3`,
    // TikTok 403s post pages that come in too fast after the JS challenge;
    // throttling per-request extraction keeps it under that threshold.
    '--sleep-request', '5-10',
    '--retries', '8',
    profileUrl
  ],
  { stdio: 'inherit' }
);

if (result.error) {
  console.error('❌ gallery-dl not found. Install with: pipx install gallery-dl');
  process.exit(1);
}
if (result.status !== 0) {
  console.error('❌ Download failed. If this keeps happening, log into tiktok.com in Chrome and retry.');
}
process.exit(result.status ?? 1);
