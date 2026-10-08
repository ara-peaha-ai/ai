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
const rotationIndex = args.indexOf('--rotation');
const rotation = rotationIndex !== -1 ? Number(args[rotationIndex + 1]) : 0;
const colorIndex = args.indexOf('--color');
const color = colorIndex !== -1 ? args[colorIndex + 1] : 'black';
// ponytail: skip flag-value slots (e.g. the string after --text) so a
// positional that comes after the flags isn't mistaken for a flag's value
const consumed = new Set([textIndex + 1, opacityIndex + 1, fontSizeIndex + 1, rotationIndex + 1, colorIndex + 1]);
const input = args.find((a, i) => !a.startsWith('-') && !consumed.has(i));

if (args.includes('--help') || args.includes('-h') || !input || !text) {
  console.error('Usage: watermark-image --text <string> [--opacity 0.25] [--font-size 36] [--rotation 0] [--color black] <input.jpg>');
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ponytail: tile sized to the text (min 256px) regardless of image size (matches the original
// ondanovia-latam image path); watermark-video.js scales its tile to the
// frame instead — kept as two different behaviors, not reconciled here.
function watermarkTileSvg(wmText, size, wmOpacity, wmRotation, wmColor) {
  // ponytail: text width estimated as 0.6em per char (no font metrics), plus a
  // 1em gap; the tile grows to fit the rotated text's bounding box, min 256px
  const rad = (wmRotation * Math.PI) / 180;
  const textW = wmText.length * size * 0.6 + size;
  const textH = size * 1.2 + size;
  const tileW = Math.max(256, Math.ceil(Math.abs(textW * Math.cos(rad)) + Math.abs(textH * Math.sin(rad))));
  const tileH = Math.max(256, Math.ceil(Math.abs(textW * Math.sin(rad)) + Math.abs(textH * Math.cos(rad))));
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${tileW}" height="${tileH}">
      <g transform="rotate(${wmRotation} ${tileW / 2} ${tileH / 2})">
        <text x="${tileW / 2}" y="${tileH / 2}" font-family="sans-serif" font-size="${size}"
          fill="${escapeXml(wmColor)}" fill-opacity="${wmOpacity}" text-anchor="middle" dominant-baseline="middle">${escapeXml(wmText)}</text>
      </g>
    </svg>`);
}

const { dir, name, ext } = path.parse(input);
const output = path.join(dir, `${name}-watermarked${ext}`);

sharp(fs.readFileSync(input))
  .composite([{ input: watermarkTileSvg(text, fontSize, opacity, rotation, color), tile: true }])
  .toFile(output)
  .then(() => console.log(output))
  .catch((err) => {
    console.error('❌', err.message);
    process.exit(1);
  });
