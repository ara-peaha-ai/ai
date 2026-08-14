#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('-'));

if (args.includes('--help') || args.includes('-h') || !target) {
  console.error('Usage: instagram-download-batch <username-or-profile-url>');
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

const username = target.replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, '');
const profileUrl = `https://www.instagram.com/${username}/`;

fs.mkdirSync(username, { recursive: true });

// ponytail: gallery-dl, not yt-dlp — yt-dlp's Instagram extractors are
// currently broken upstream (both instagram:user and single-post video).
const FILENAME_FORMAT = '{username}-{date:%Y%m%dT%H%M%S}_{num}.{extension}';

// --download-archive skips posts already downloaded on a rerun, which is
// the whole point of hitting a profile repeatedly over time.
const result = spawnSync(
  'gallery-dl',
  [
    '--cookies-from-browser', 'brave',
    '-o', 'include=posts,highlights',
    '-D', username,
    '-f', FILENAME_FORMAT,
    '--download-archive', `${username}/.downloaded.sqlite3`,
    profileUrl
  ],
  { stdio: 'inherit' }
);

if (result.error) {
  console.error('❌ gallery-dl not found. Install with: pipx install gallery-dl');
  process.exit(1);
}
if (result.status !== 0) {
  console.error('❌ Download failed. If this keeps happening, log into instagram.com in Brave and retry.');
}
process.exit(result.status ?? 1);
