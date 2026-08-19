#!/usr/bin/env node
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = '/usr/bin/google-chrome-stable';
const USER_DATA_DIR = path.join(__dirname, 'chrome-profile-chatgpt');
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // time given to log in by hand in the headful window

const args = process.argv.slice(2);
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

if (args.includes('--help') || args.includes('-h') || !imagePath || !prompt) {
  console.error('Usage: chatgpt-image --image /path/to/image.jpg --prompt "your prompt"');
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

if (!fs.existsSync(imagePath)) {
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

async function launchBrowser(headless) {
  return puppeteer.launch({
    executablePath: CHROME_PATH,
    userDataDir: USER_DATA_DIR,
    headless,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });
}

// ponytail: headless-first, headful-only-if-needed keeps normal runs invisible
// while still covering the "cookie expired" case without a separate login script.
async function openAuthenticatedPage(browser) {
  const page = await browser.newPage();
  await page.goto('https://chat.openai.com/', { waitUntil: 'networkidle2' });
  try {
    await page.waitForSelector('#prompt-textarea', { timeout: 15000 });
    return { page, browser };
  } catch {
    console.log('🔐 Not logged in. Opening a visible Chrome window — log in, then the script will continue automatically...');
  }

  await browser.close();
  const headfulBrowser = await launchBrowser(false);
  const headfulPage = await headfulBrowser.newPage();
  await headfulPage.goto('https://chat.openai.com/', { waitUntil: 'networkidle2' });
  await headfulPage.waitForSelector('#prompt-textarea', { timeout: LOGIN_TIMEOUT_MS });
  console.log('✅ Logged in.');
  return { page: headfulPage, browser: headfulBrowser };
}

(async () => {
  let browser;
  try {
    browser = await launchBrowser(true);
    const auth = await openAuthenticatedPage(browser);
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
