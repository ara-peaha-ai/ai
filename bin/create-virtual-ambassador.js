#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { resolveBrowser } = require('./lib/browser');
const { delay, typeHuman, openAuthenticatedPage, runDumpCookies } = require('./lib/chatgpt-session');
const { IMAGE_EXT } = require('./lib/sort-media');

// Load repo-root .env (BROWSERLESS_API_KEY, AICLI_BROWSER, ...) if present.
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  /* no .env, or Node < 20.12 — env vars can still come from the shell */
}

// same ChatGPT session as chatgpt-image — one login, shared by both commands.
const USER_DATA_DIR = path.join(__dirname, 'chrome-profile-chatgpt');
const COOKIES_FILE = process.env.CHATGPT_COOKIES_FILE || path.join(__dirname, 'chatgpt-cookies.json');
const CMD_NAME = 'create-virtual-ambassador';

// ponytail: one line, no literal newlines — page.type() presses a real Enter
// for '\n' (Puppeteer's Keyboard.type charIsKey check), which would submit
// the message mid-prompt in ChatGPT's textarea instead of inserting a line break.
const PROMPT = 'Using the input images attached to this prompt as reference, generate three separate portrait images of a model derived from them — as three distinct image outputs in this response, not a single grid or collage. Each output must show the full body from head to feet in a standing pose (not a close-up portrait, bust, or half-body crop), framed within a 1:1 square layout with a transparent background. First image, near-identical: closely preserve the original model\'s distinctive facial features for a faithful, close likeness. Second image, resembling: keep the general facial structure and distinctive features recognizable, but alter enough details (eyes, nose, jawline, hair, skin tone) that it resembles the original without being identical or the same person. Third image, loosely inspired: use the references only as a loose stylistic starting point — keep broad traits like hair color and body type, but generate a clearly different face/identity, not recognizable as the same person.';

// order matches the 1/2/3 list in PROMPT above — used to label output files
// when exactly three images come back (the common case).
const VARIANT_LABELS = ['identical', 'resembling', 'inspired'];

// ponytail: we can detect a guardrail refusal (the chat text says so), but we
// have no way to tell which of the N uploaded images triggered it — that'd need
// its own nudity/content classifier. Report it and let a human pick.
const GUARDRAIL_PATTERN = /guardrails around nudity, sexuality, or erotic content/i;

const args = process.argv.slice(2);
const dumpCookies = args.includes('--dump-cookies');
const imagesDir = path.resolve(args.find((a) => !a.startsWith('-')) || 'references');

if (args.includes('--help') || args.includes('-h')) {
  console.error(
    [
      'Usage: create-virtual-ambassador [images-dir]',
      '       create-virtual-ambassador --dump-cookies   (local login -> chatgpt-cookies.json, for remote/VPS use)',
      '',
      '  [images-dir]   folder of reference images to upload — defaults to "./references"',
      '',
      'Uploads every image in [images-dir] to ChatGPT in one message with a fixed prompt',
      'asking for three full-body, 1:1, transparent-background variants derived from',
      'them (near-identical / resembling / loosely inspired), and saves each as',
      '"avatar/genesis-<identical|resembling|inspired>.<ext>" in the current directory.',
      '',
      'If ChatGPT refuses on content-guideline grounds, this cannot tell which input',
      'image(s) triggered it — it just reports the refusal so you can remove one by',
      'hand (most likely a partial-body or suggestive shot) and try again.',
      '',
      'Browser: auto-detected (chrome/chromium/brave, OS default preferred). Shares',
      'the login/cookies with chatgpt-image.',
      '  AICLI_BROWSER=chrome|chromium|brave|browserless|/abs/path   force a choice',
      '  BROWSERLESS_API_KEY=...                                     use browserless.io (headless/VPS)',
    ].join('\n')
  );
  process.exit(0);
}

let imagePaths = [];
if (!dumpCookies) {
  if (!fs.existsSync(imagesDir) || !fs.statSync(imagesDir).isDirectory()) {
    console.error(`❌ Not a directory: ${imagesDir}`);
    process.exit(1);
  }
  imagePaths = fs.readdirSync(imagesDir, { withFileTypes: true })
    .filter((e) => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(imagesDir, e.name));
  if (imagePaths.length === 0) {
    console.error(`❌ No images found in ${imagesDir}`);
    process.exit(1);
  }
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

    // same network-sniffing approach as chatgpt-image — DOM selectors churn,
    // the generated-image response URL pattern doesn't.
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
    await fileInput.uploadFile(...imagePaths);
    console.log(`📤 ${imagePaths.length} image(s) uploaded: ${imagePaths.map((p) => path.basename(p)).join(', ')}`);

    await delay(500 * imagePaths.length); // give the UI time to render every thumbnail

    console.log('✏️ Typing prompt...');
    await typeHuman(page, '#prompt-textarea', PROMPT);
    console.log('✏️ Prompt typed.');

    await delay(300);

    const sendButton = await page.$('button[data-testid="send-button"]');
    if (!sendButton) throw new Error('Send button not found (data-testid may have changed).');
    await sendButton.click();
    console.log('📨 Sent.');
    const sendTime = Date.now();

    console.log('⏳ Waiting for generated images (3 expected) or a refusal...');
    const timeoutMs = 180000; // 3 images render slower than 1
    const settleMs = 8000; // stop early once no new image has arrived for this long
    const deadline = Date.now() + timeoutMs;
    let refused = false;
    let lastImageAt = null;
    while (Date.now() < deadline) {
      const seenNow = matchedImageResponses.filter((r) => r.time > sendTime);
      if (seenNow.length > 0) {
        lastImageAt = Math.max(...seenNow.map((r) => r.time));
        if (Date.now() - lastImageAt > settleMs) break; // no new image for a while, assume done
      }

      const bodyText = await page.evaluate(() => document.body.innerText);
      if (GUARDRAIL_PATTERN.test(bodyText)) { refused = true; break; }

      await delay(1000);
    }

    if (refused) {
      console.error('🚫 ChatGPT refused — the prompt may violate content guidelines (nudity/sexuality/erotic content).');
      console.error(
        `   Can't tell which of the ${imagePaths.length} input image(s) triggered it. Remove the one you suspect\n` +
        '   (most likely a partial-body, close-crop, or suggestive shot) from the images folder and try again:\n' +
        `   ${imagePaths.map((p) => `   - ${path.basename(p)}`).join('\n')}`
      );
      process.exitCode = 1;
      return;
    }

    const images = matchedImageResponses.filter((r) => r.time > sendTime);
    if (images.length === 0) {
      const seen = allImageResponses.filter((r) => r.time > sendTime);
      console.error(`❌ No matching image response after ${timeoutMs / 1000}s. Image responses seen since send:`);
      seen.forEach((r) => console.error(`   - ${r.contentType} ${r.url}`));
      throw new Error('Generated image not found (network sniffing found no match - adjust the URL pattern above if the list is non-empty).');
    }

    console.log(`🖼️ ${images.length} image(s) found, downloading...`);

    const outputDir = path.join(process.cwd(), 'avatar');
    fs.mkdirSync(outputDir, { recursive: true });

    for (let i = 0; i < images.length; i++) {
      const { url } = images[i];
      const imageBuffer = await page.evaluate(async (u) => {
        const response = await fetch(u);
        if (!response.ok) {
          throw new Error(`Download failed: ${response.status} ${response.statusText}`);
        }
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        return Array.from(new Uint8Array(arrayBuffer));
      }, url);

      if (!imageBuffer || imageBuffer.length === 0) {
        console.error(`   ⚠️ image ${i + 1}: downloaded buffer is empty, skipping`);
        continue;
      }

      let ext = 'png';
      try {
        const urlExt = path.extname(new URL(url).pathname);
        if (urlExt) ext = urlExt.slice(1);
      } catch (e) {}

      // labelled by prompt order (identical/resembling/inspired) when the count
      // matches; otherwise a plain 1-based number so nothing is mislabeled.
      const label = images.length === VARIANT_LABELS.length ? VARIANT_LABELS[i] : String(i + 1);
      const outputPath = path.join(outputDir, `genesis-${label}.${ext}`);
      fs.writeFileSync(outputPath, Buffer.from(imageBuffer));
      console.log(`💾 ${label} -> ${outputPath} (${fs.statSync(outputPath).size} bytes)`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
