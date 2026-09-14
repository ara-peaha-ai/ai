const fs = require('fs');
const path = require('path');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.heif', '.tif', '.tiff']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v']);

const walk = (dir, skipDirs, acc = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(full)) walk(full, skipDirs, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
};

// Moves every image into "<baseDir>/img" and every video into "<baseDir>/vid",
// flattening whatever subfolder structure gallery-dl created (e.g. per-highlight
// folders on Instagram), then removes the now-empty leftover subfolders.
const sortIntoImgVid = (baseDir) => {
  const imgDir = path.join(baseDir, 'img');
  const vidDir = path.join(baseDir, 'vid');
  const skipDirs = new Set([imgDir, vidDir]);

  const counts = { images: 0, videos: 0 };
  for (const file of walk(baseDir, skipDirs)) {
    const ext = path.extname(file).toLowerCase();
    const destDir = IMAGE_EXT.has(ext) ? imgDir : VIDEO_EXT.has(ext) ? vidDir : null;
    if (!destDir) continue; // ponytail: unrecognised extension, leave it where it is

    fs.mkdirSync(destDir, { recursive: true });
    fs.renameSync(file, path.join(destDir, path.basename(file)));
    if (destDir === imgDir) counts.images++;
    else counts.videos++;
  }

  // prune subfolders gallery-dl left behind now that their files moved out
  const dirs = [];
  const collectDirs = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (skipDirs.has(full)) continue;
      collectDirs(full);
      dirs.push(full);
    }
  };
  collectDirs(baseDir);
  for (const dir of dirs) {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }

  return counts;
};

module.exports = { sortIntoImgVid };
