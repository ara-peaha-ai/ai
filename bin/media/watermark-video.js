#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const sharp = require('sharp');

const args = process.argv.slice(2);
const textIndex = args.indexOf('--text');
const text = textIndex !== -1 ? args[textIndex + 1] : null;
const opacityIndex = args.indexOf('--opacity');
const opacity = opacityIndex !== -1 ? Number(args[opacityIndex + 1]) : 0.25;
const fontSizeIndex = args.indexOf('--font-size');
const fontSize = fontSizeIndex !== -1 ? Number(args[fontSizeIndex + 1]) : 36;
// ponytail: skip flag-value slots (e.g. the string after --text) so a
// positional that comes after the flags isn't mistaken for a flag's value
const consumed = new Set([textIndex + 1, opacityIndex + 1, fontSizeIndex + 1]);
const input = args.find((a, i) => !a.startsWith('-') && !consumed.has(i));

if (args.includes('--help') || args.includes('-h') || !input || !text) {
  console.error('Usage: watermark-video --text <string> [--opacity 0.25] [--font-size 36] <input.mp4>');
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function watermarkTileSvg(wmText, size, wmOpacity) {
  const tileSize = 256;
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${tileSize}" height="${tileSize}">
      <g transform="rotate(-45 ${tileSize / 2} ${tileSize / 2})">
        <text x="${tileSize / 2}" y="${tileSize / 2}" font-family="sans-serif" font-size="${size}"
          fill="white" fill-opacity="${wmOpacity}" text-anchor="middle" dominant-baseline="middle">${escapeXml(wmText)}</text>
      </g>
    </svg>`);
}

const { dir, name, ext } = path.parse(input);
const output = path.join(dir, `${name}-watermarked${ext}`);
const tmpFrame = path.join(os.tmpdir(), `wm-frame-${crypto.randomUUID()}.png`);
const tmpOverlay = path.join(os.tmpdir(), `wm-overlay-${crypto.randomUUID()}.png`);
const cleanup = () => {
  fs.rmSync(tmpFrame, { force: true });
  fs.rmSync(tmpOverlay, { force: true });
};

(async () => {
  // 1) grab first frame to know the video's real pixel size
  const frame = spawnSync('ffmpeg', ['-y', '-i', input, '-frames:v', '1', tmpFrame], { stdio: 'inherit' });
  if (frame.error) {
    console.error('❌ ffmpeg not found. Install with: sudo apt install ffmpeg');
    process.exit(1);
  }
  if (frame.status !== 0) {
    cleanup();
    process.exit(frame.status ?? 1);
  }

  // 2) build a full-frame transparent PNG tiled with the rotated watermark text
  try {
    const { width, height } = await sharp(tmpFrame).metadata();

    const tileRaster = await sharp(watermarkTileSvg(text, fontSize, opacity))
      .resize(Math.floor(width / 3), Math.floor(height / 3), {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toBuffer();

    await sharp({
      create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
      .composite([{ input: tileRaster, tile: true }])
      .png()
      .toFile(tmpOverlay);
  } catch (err) {
    console.error('❌', err.message);
    cleanup();
    process.exit(1);
  }

  // 3) overlay the watermark PNG onto every frame of the video
  const overlay = spawnSync(
    'ffmpeg',
    [
      '-y', '-i', input, '-i', tmpOverlay,
      '-filter_complex', '[0][1]overlay=0:0:format=auto',
      '-c:a', 'copy',
      '-movflags', 'faststart',
      output
    ],
    { stdio: 'inherit' }
  );
  cleanup();
  process.exit(overlay.status ?? 1);
})();
