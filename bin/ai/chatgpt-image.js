#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { resolveBrowser } = require('../lib/browser');
const { delay, typeHuman, openAuthenticatedPage, runDumpCookies } = require('../lib/chatgpt-session');

// Load repo-root .env (BROWSERLESS_API_KEY, AICLI_BROWSER, ...) if present.
try {
  process.loadEnvFile(path.join(__dirname, '..', '..', '.env'));
} catch {
  /* no .env, or Node < 20.12 — env vars can still come from the shell */
}

const USER_DATA_DIR = path.join(__dirname, 'chrome-profile-chatgpt');
const COOKIES_FILE = process.env.CHATGPT_COOKIES_FILE || path.join(__dirname, 'chatgpt-cookies.json');
const CMD_NAME = 'chatgpt-image';

const args = process.argv.slice(2);
const dumpCookies = args.includes('--dump-cookies');
let imagePath = null;
let prompt = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--image' && args[i + 1]) {
    imagePath = path.resolve(args[i + 1]);
    i++;
  } else if (args[i] === '--prompt' && args[i + 1]) {
    prompt = args[i + 1];
    i++;
  }
}

if (args.includes('--help') || args.includes('-h') || (!dumpCookies && (!imagePath || !prompt))) {
  console.error(
    [
      'Usage: chatgpt-image --image /path/to/image.jpg --prompt "your prompt"',
      '       chatgpt-image --dump-cookies      (local login -> chatgpt-cookies.json, for remote/VPS use)',
      '',
      'Browser: auto-detected (chrome/chromium/brave, OS default preferred).',
      '  AICLI_BROWSER=chrome|chromium|brave|browserless|/abs/path   force a choice',
      '  BROWSERLESS_API_KEY=...                                     use browserless.io (headless/VPS)',
    ].join('\n')
  );
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

if (!dumpCookies && !fs.existsSync(imagePath)) {
  console.error(`❌ Image file not found: ${imagePath}`);
  process.exit(1);
}

(async () => {
  if (dumpCookies) {
    try {
      await runDumpCookies({ userDataDir: USER_DATA_DIR, cookiesFile: COOKIES_FILE });
    } catch (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }
    return;
  }

  let browser;
  try {
    const picked = resolveBrowser();
    console.log(`🌐 ${picked.label}`);
    const auth = await openAuthenticatedPage(picked, { userDataDir: USER_DATA_DIR, cookiesFile: COOKIES_FILE, cmdName: CMD_NAME });
    browser = auth.browser;
    const page = auth.page;

    // ponytail: DOM selectors (data-testid, data-message-author-role, :last-child) churn
    // constantly on ChatGPT's UI. Sniffing the network response for the generated image
    // is far more stable - it doesn't care what the DOM looks like.
    const allImageResponses = [];
    const matchedImageResponses = [];
    page.on('response', (response) => {
      const url = response.url();
      const contentType = response.headers()['content-type'] || '';
      if (!contentType.startsWith('image/')) return;
      allImageResponses.push({ url, contentType, time: Date.now() });
      if (/oaiusercontent\.com|backend-api\/estuary\/content/.test(url)) {
        matchedImageResponses.push({ url, time: Date.now() });
      }
    });

    console.log('✅ Ready.');

    const fileInput = await page.$('input[type="file"]');
    if (!fileInput) throw new Error('File input not found.');
    await fileInput.uploadFile(imagePath);
    console.log('📤 Image uploaded.');

    await delay(500);

    console.log('✏️ Typing prompt...');
    await typeHuman(page, '#prompt-textarea', prompt);
    console.log('✏️ Prompt typed.');

    await delay(300);

    const sendButton = await page.$('button[data-testid="send-button"]');
    if (!sendButton) throw new Error('Send button not found (data-testid may have changed).');
    await sendButton.click();
    console.log('📨 Sent.');
    const sendTime = Date.now();

    // --- WAIT FOR THE GENERATED IMAGE via network response, not DOM scraping ---
    console.log('⏳ Waiting for generated image...');

    const timeoutMs = 150000;
    const deadline = Date.now() + timeoutMs;
    let imageSrc = null;
    while (Date.now() < deadline) {
      const hit = matchedImageResponses.find((r) => r.time > sendTime);
      if (hit) { imageSrc = hit.url; break; }
      await delay(1000);
    }

    if (!imageSrc) {
      const seen = allImageResponses.filter((r) => r.time > sendTime);
      console.error(`❌ No matching image response after ${timeoutMs / 1000}s. Image responses seen since send:`);
      seen.forEach((r) => console.error(`   - ${r.contentType} ${r.url}`));
      throw new Error('Generated image not found (network sniffing found no match - adjust the URL pattern above if the list is non-empty).');
    }

    console.log(`🔗 Image URL: ${imageSrc}`);
    console.log('🖼️ Image found, downloading...');

    // Download the image using fetch
    const imageBuffer = await page.evaluate(async (url) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      return Array.from(new Uint8Array(arrayBuffer));
    }, imageSrc);

    if (!imageBuffer || imageBuffer.length === 0) {
      throw new Error('Downloaded image buffer is empty!');
    }
    console.log(`📦 Buffer size: ${imageBuffer.length} bytes`);

    let ext = 'png';
    try {
      const urlExt = path.extname(new URL(imageSrc).pathname);
      if (urlExt) ext = urlExt.slice(1);
    } catch (e) {}

    const inputBase = path.basename(imagePath);
    const inputDir = path.dirname(imagePath);
    const baseName = path.basename(inputBase, path.extname(inputBase));
    const outputFileName = `${baseName}-mod.${ext}`;
    const outputPath = path.join(inputDir, outputFileName);

    fs.writeFileSync(outputPath, Buffer.from(imageBuffer));
    console.log(`💾 Image saved to: ${outputPath}`);
    console.log(`📁 File size: ${fs.statSync(outputPath).size} bytes`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (browser) await browser.close();
  }
})();
