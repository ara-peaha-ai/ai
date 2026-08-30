#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const userIndex = args.indexOf('--api-user');
const secretIndex = args.indexOf('--api-secret');
const apiUser = userIndex !== -1 ? args[userIndex + 1] : process.env.SIGHTENGINE_USER;
const apiSecret = secretIndex !== -1 ? args[secretIndex + 1] : process.env.SIGHTENGINE_SECRET;
// ponytail: skip flag-value slots so a positional after the flags isn't
// mistaken for a flag's value (e.g. --api-user U --api-secret S input.jpg)
const consumed = new Set([userIndex + 1, secretIndex + 1]);
const input = args.find((a, i) => !a.startsWith('-') && !consumed.has(i));

if (args.includes('--help') || args.includes('-h') || !input || !apiUser || !apiSecret) {
  console.error('Usage: redact-faces --api-user <user> --api-secret <secret> <input.jpg|input.mp4>');
  console.error('  (or set SIGHTENGINE_USER / SIGHTENGINE_SECRET env vars instead of the flags)');
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi']);
const { dir, name, ext } = path.parse(input);
const isVideo = VIDEO_EXT.has(ext.toLowerCase());
const output = path.join(dir, `${name}-redacted${ext}`);

async function redactImage(buffer, filename) {
  const form = new FormData();
  form.append('media', new Blob([buffer]), filename);
  form.append('concepts', 'face');
  form.append('api_user', apiUser);
  form.append('api_secret', apiSecret);

  const resp = await fetch('https://api.sightengine.com/1.0/transform.json', { method: 'POST', body: form });
  if (!resp.ok) throw new Error(`Sightengine image transform failed (${resp.status}): ${await resp.text()}`);
  const data = await resp.json();
  if (!data.transform?.base64) throw new Error(`Missing base64 in response: ${JSON.stringify(data)}`);
  return Buffer.from(data.transform.base64, 'base64');
}

async function redactVideo(buffer, filename) {
  const form = new FormData();
  form.append('media', new Blob([buffer]), filename);
  form.append('concepts', 'face');
  form.append('api_user', apiUser);
  form.append('api_secret', apiSecret);

  const submitResp = await fetch('https://api.sightengine.com/1.0/video/transform.json', { method: 'POST', body: form });
  if (!submitResp.ok) {
    throw new Error(`Sightengine video transform submission failed (${submitResp.status}): ${await submitResp.text()}`);
  }
  const submitData = await submitResp.json();
  const mediaId = submitData.media?.id;
  if (!mediaId) throw new Error(`Missing media id in transform response: ${JSON.stringify(submitData)}`);

  // poll for completion — 30 attempts, 2s apart (videos can take a while to redact)
  const maxAttempts = 30;
  const delayMs = 2000;
  let locationUrl = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const pollResp = await fetch(
      `https://api.sightengine.com/1.0/video/byid.json?id=${mediaId}&api_user=${apiUser}&api_secret=${apiSecret}`
    );
    if (pollResp.ok) {
      const pollData = await pollResp.json();
      const status = pollData.output?.data?.status;
      const transformLoc = pollData.output?.data?.transform?.location;
      if (status === 'finished' && transformLoc) {
        locationUrl = transformLoc;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  if (!locationUrl) throw new Error(`Transform did not complete in time after ${maxAttempts} attempts: ${mediaId}`);

  const downloadResp = await fetch(locationUrl);
  if (!downloadResp.ok) throw new Error(`Failed to download redacted video (${downloadResp.status})`);
  return Buffer.from(await downloadResp.arrayBuffer());
}

(async () => {
  try {
    const buffer = fs.readFileSync(input);
    const filename = path.basename(input);
    const result = isVideo ? await redactVideo(buffer, filename) : await redactImage(buffer, filename);
    fs.writeFileSync(output, result);
    console.log(output);
  } catch (err) {
    console.error('❌', err.message);
    process.exit(1);
  }
})();
