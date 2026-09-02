#!/usr/bin/env node
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const { openBrowser, resolveBrowser, isHeadlessBox } = require('./lib/browser');

// Load repo-root .env (BROWSERLESS_API_KEY, AICLI_BROWSER, ...) if present.
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  /* no .env, or Node < 20.12 — env vars can still come from the shell */
}

const USER_DATA_DIR = path.join(__dirname, 'chrome-profile-chatgpt');
const COOKIES_FILE = process.env.CHATGPT_COOKIES_FILE || path.join(__dirname, 'chatgpt-cookies.json');
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // time given to log in by hand in the headful window
const LOGGED_IN_SELECTOR = '#prompt-textarea';
const START_URL = 'https://chatgpt.com/';
const LAUNCH_ARGS = ['--disable-blink-features=AutomationControlled', '--no-sandbox'];

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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function typeHuman(page, selector, text) {
  await page.click(selector);
  for (let char of text) {
    await page.type(selector, char, { delay: Math.floor(Math.random() * 120) + 80 });
  }
}

const COOKIE_FIELDS = ['name', 'value', 'domain', 'path', 'expires', 'httpOnly', 'secure', 'sameSite'];

async function readAllCookies(page) {
  const client = await page.createCDPSession();
  const { cookies } = await client.send('Network.getAllCookies');
  return cookies
    .filter((c) => /openai\.com$|chatgpt\.com$/.test(c.domain.replace(/^\./, '')))
    .map((c) => Object.fromEntries(COOKIE_FIELDS.map((k) => [k, c[k]]).filter(([, v]) => v !== undefined)));
}

async function loadCookiesFromFile(page) {
  if (!fs.existsSync(COOKIES_FILE)) {
    throw new Error(
      `No cookie file at ${COOKIES_FILE}. On a machine with a display run \`chatgpt-image --dump-cookies\`, then copy that file here.`
    );
  }
  const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
  if (Array.isArray(cookies) && cookies.length) await page.setCookie(...cookies);
}

// Local launch: headless-first, fall back to a visible window for a hand login
// (only possible with a display). Remote (browserless): inject cookies from file.
async function openAuthenticatedPage(picked) {
  if (picked.mode === 'remote') {
    const { browser } = await openBrowser(puppeteer, {}, { picked });
    const page = await browser.newPage();
    await loadCookiesFromFile(page);
    await page.goto(START_URL, { waitUntil: 'networkidle2' });
    try {
      await page.waitForSelector(LOGGED_IN_SELECTOR, { timeout: 20000 });
    } catch {
      await browser.close();
      throw new Error(
        `Remote browser is not logged in — cookies in ${COOKIES_FILE} are missing or expired. Regenerate with \`chatgpt-image --dump-cookies\` on a machine with a display.`
      );
    }
    return { page, browser };
  }

  let { browser } = await openBrowser(puppeteer, {
    userDataDir: USER_DATA_DIR,
    headless: true,
    launchArgs: LAUNCH_ARGS,
  }, { picked });
  let page = await browser.newPage();
  await page.goto(START_URL, { waitUntil: 'networkidle2' });
  try {
    await page.waitForSelector(LOGGED_IN_SELECTOR, { timeout: 15000 });
    return { page, browser };
  } catch {
    /* not logged in — need a hand login */
  }

  if (isHeadlessBox()) {
    await browser.close();
    throw new Error(
      'Not logged in and no display for a hand login. Either set BROWSERLESS_API_KEY + provide chatgpt-cookies.json, or run once on a desktop to seed the profile.'
    );
  }

  console.log('🔐 Not logged in. Opening a visible window — log in, then the script continues automatically...');
  await browser.close();
  ({ browser } = await openBrowser(
    puppeteer,
    { userDataDir: USER_DATA_DIR, headless: false, launchArgs: LAUNCH_ARGS },
    { picked }
  ));
  page = await browser.newPage();
  await page.goto(START_URL, { waitUntil: 'networkidle2' });
  await page.waitForSelector(LOGGED_IN_SELECTOR, { timeout: LOGIN_TIMEOUT_MS });
  console.log('✅ Logged in.');
  return { page, browser };
}

async function runDumpCookies() {
  if (isHeadlessBox()) {
    console.error('❌ --dump-cookies needs a display (it opens a window for you to log in). Run it on your desktop.');
    process.exit(1);
  }
  const { browser, picked } = await openBrowser(puppeteer, {
    userDataDir: USER_DATA_DIR,
    headless: false,
    launchArgs: LAUNCH_ARGS,
  });
  console.log(`🌐 ${picked.label}`);
  try {
    const page = await browser.newPage();
    await page.goto(START_URL, { waitUntil: 'networkidle2' });
    console.log('🔐 Log in if prompted — waiting for the chat box...');
    await page.waitForSelector(LOGGED_IN_SELECTOR, { timeout: LOGIN_TIMEOUT_MS });
    const cookies = await readAllCookies(page);
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
    console.log(`💾 ${cookies.length} cookies -> ${COOKIES_FILE}`);
    console.log('   Copy this file to the headless host (same path, or set CHATGPT_COOKIES_FILE).');
  } finally {
    await browser.close();
  }
}

(async () => {
  if (dumpCookies) {
    try {
      await runDumpCookies();
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
    const auth = await openAuthenticatedPage(picked);
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
