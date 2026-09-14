#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const { sortIntoImgVid, extractProfilePhoto } = require('./lib/sort-media');

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('-'));

if (args.includes('--help') || args.includes('-h') || !target) {
  console.error('Usage: x-download-batch <username-or-profile-url>');
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

const username = target
  .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//, '')
  .replace(/\/.*$/, '')
  .replace(/^@/, '');
const profileUrl = `https://x.com/${username}`;

const OUTPUT_DIR = 'x';
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// {subcategory} tags avatar downloads so extractProfilePhoto() can pick them out.
// "media" is gallery-dl's own media-tab filter — only tweets that actually
// contain a photo/video, skipping text-only tweets and replies entirely.
const FILENAME_FORMAT = '{user[name]}-{subcategory}-{date:%Y%m%dT%H%M%S}_{num}.{extension}';

// --download-archive skips posts already downloaded on a rerun, which is
// the whole point of hitting a profile repeatedly over time. Shared across
// all profiles in OUTPUT_DIR since gallery-dl keys entries by post id.
// "avatar" pulls the current profile picture too — used as a reference photo
// (e.g. for create-virtual-ambassador's face-similarity scoring).
const result = spawnSync(
  'gallery-dl',
  [
    '--cookies-from-browser', 'chrome',
    '-o', 'include=media,avatar',
    '-D', OUTPUT_DIR,
    '-f', FILENAME_FORMAT,
    '--download-archive', `${OUTPUT_DIR}/.downloaded.sqlite3`,
    profileUrl
  ],
  { stdio: 'inherit' }
);

if (result.error) {
  console.error('❌ gallery-dl not found. Install with: pipx install gallery-dl');
  process.exit(1);
}

const profilePhoto = extractProfilePhoto(OUTPUT_DIR);
if (profilePhoto) console.log(`🙂 profile photo -> ${profilePhoto}`);

const { images, videos } = sortIntoImgVid(OUTPUT_DIR);
console.log(`📂 sorted: ${images} image(s) -> ${OUTPUT_DIR}/img, ${videos} video(s) -> ${OUTPUT_DIR}/vid`);

if (result.status !== 0) {
  console.error('❌ Download failed. If this keeps happening, log into x.com in Chrome and retry.');
}
process.exit(result.status ?? 1);
