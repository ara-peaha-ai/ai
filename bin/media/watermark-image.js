#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
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
  console.error('Usage: watermark-image --text <string> [--opacity 0.25] [--font-size 36] <input.jpg>');
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ponytail: fixed 256px tile regardless of image size (matches the original
// legacy-app image path); watermark-video.js scales its tile to the
// frame instead — kept as two different behaviors, not reconciled here.
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

sharp(fs.readFileSync(input))
  .composite([{ input: watermarkTileSvg(text, fontSize, opacity), tile: true }])
  .toFile(output)
  .then(() => console.log(output))
  .catch((err) => {
    console.error('❌', err.message);
    process.exit(1);
  });
