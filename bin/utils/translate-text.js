#!/usr/bin/env node
const path = require('path');
const deepl = require('deepl-node');

try {
  process.loadEnvFile(path.join(__dirname, '..', '..', '.env'));
} catch {}

const args = process.argv.slice(2);
const getFlag = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
};
const input = getFlag('--input');
const output = getFlag('--output');

if (args.includes('--help') || args.includes('-h') || !input || !output) {
  console.error('Usage: translate-text --input "text" --output IT');
  console.error('       --output = DeepL target language: IT, ES, DE, FR, PT-BR, PT-PT, EN-US, EN-GB, ...');
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

if (!process.env.DEEPL_API_KEY) {
  console.error(`❌ DEEPL_API_KEY is not set (shell env or ${path.join(__dirname, '..', '..', '.env')})`);
  process.exit(1);
}

// ponytail: source language auto-detected by DeepL; add --from if detection ever guesses wrong
new deepl.DeepLClient(process.env.DEEPL_API_KEY)
  .translateText(input, null, output.toLowerCase())
  .then((result) => console.log(result.text))
  .catch((e) => {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  });
