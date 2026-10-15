#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { parseEnv } = require('util');
const deepl = require('deepl-node');

const ENV_FILE = path.join(__dirname, '..', '..', '.env');

// Only DEEPL_API_KEY is read from .env, so the other keys in that file never reach deepl-node
if (!process.env.DEEPL_API_KEY) {
  try {
    process.env.DEEPL_API_KEY = parseEnv(fs.readFileSync(ENV_FILE, 'utf8')).DEEPL_API_KEY || '';
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error(`❌ cannot read ${ENV_FILE}: ${e.message}`);
      process.exit(1);
    }
  }
}

const args = process.argv.slice(2);
// A missing value, or one that is another flag, counts as not given
const getFlag = (name) => {
  const value = args.includes(name) ? args[args.indexOf(name) + 1] : null;
  return value && !value.startsWith('--') ? value : null;
};
const input = getFlag('--input');
const output = getFlag('--output');

if (args.includes('--help') || args.includes('-h') || !input || !output) {
  console.error('Usage: translate-text --input "text" --output IT');
  console.error('       --output = DeepL target language: IT, ES, DE, FR, PT-BR, PT-PT, EN-US, EN-GB, ...');
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

if (!process.env.DEEPL_API_KEY) {
  console.error(`❌ DEEPL_API_KEY is not set (shell env or ${ENV_FILE})`);
  process.exit(1);
}

// ponytail: source language auto-detected by DeepL; add --from if detection ever guesses wrong
new deepl.DeepLClient(process.env.DEEPL_API_KEY, { sendPlatformInfo: false })
  .translateText(input, null, output.toLowerCase())
  .then((result) => console.log(result.text))
  .catch((e) => {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  });
