const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { openBrowser, isHeadlessBox } = require('./browser');

const START_URL = 'https://chatgpt.com/';
const LOGGED_IN_SELECTOR = '#prompt-textarea';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // time given to log in by hand in the headful window
const LAUNCH_ARGS = ['--disable-blink-features=AutomationControlled', '--no-sandbox'];
const COOKIE_FIELDS = ['name', 'value', 'domain', 'path', 'expires', 'httpOnly', 'secure', 'sameSite'];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const typeHuman = async (page, selector, text) => {
  await page.click(selector);
  for (const char of text) {
    await page.type(selector, char, { delay: Math.floor(Math.random() * 120) + 80 });
  }
};

const readAllCookies = async (page) => {
  const client = await page.createCDPSession();
  const { cookies } = await client.send('Network.getAllCookies');
  return cookies
    .filter((c) => /openai\.com$|chatgpt\.com$/.test(c.domain.replace(/^\./, '')))
    .map((c) => Object.fromEntries(COOKIE_FIELDS.map((k) => [k, c[k]]).filter(([, v]) => v !== undefined)));
};

const loadCookiesFromFile = async (page, cookiesFile, cmdName) => {
  if (!fs.existsSync(cookiesFile)) {
    throw new Error(
      `No cookie file at ${cookiesFile}. On a machine with a display run \`${cmdName} --dump-cookies\`, then copy that file here.`
    );
  }
  const cookies = JSON.parse(fs.readFileSync(cookiesFile, 'utf8'));
  if (Array.isArray(cookies) && cookies.length) await page.setCookie(...cookies);
};

// Local launch: headless-first, fall back to a visible window for a hand login
// (only possible with a display). Remote (browserless): inject cookies from file.
const openAuthenticatedPage = async (picked, { userDataDir, cookiesFile, cmdName }) => {
  if (picked.mode === 'remote') {
    const { browser } = await openBrowser(puppeteer, {}, { picked });
    const page = await browser.newPage();
    await loadCookiesFromFile(page, cookiesFile, cmdName);
    await page.goto(START_URL, { waitUntil: 'networkidle2' });
    try {
      await page.waitForSelector(LOGGED_IN_SELECTOR, { timeout: 20000 });
    } catch {
      await browser.close();
      throw new Error(
        `Remote browser is not logged in — cookies in ${cookiesFile} are missing or expired. Regenerate with \`${cmdName} --dump-cookies\` on a machine with a display.`
      );
    }
    return { page, browser };
  }

  let { browser } = await openBrowser(puppeteer, { userDataDir, headless: true, launchArgs: LAUNCH_ARGS }, { picked });
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
  ({ browser } = await openBrowser(puppeteer, { userDataDir, headless: false, launchArgs: LAUNCH_ARGS }, { picked }));
  page = await browser.newPage();
  await page.goto(START_URL, { waitUntil: 'networkidle2' });
  await page.waitForSelector(LOGGED_IN_SELECTOR, { timeout: LOGIN_TIMEOUT_MS });
  console.log('✅ Logged in.');
  return { page, browser };
};

const runDumpCookies = async ({ userDataDir, cookiesFile }) => {
  if (isHeadlessBox()) {
    console.error('❌ --dump-cookies needs a display (it opens a window for you to log in). Run it on your desktop.');
    process.exit(1);
  }
  const { browser, picked } = await openBrowser(puppeteer, { userDataDir, headless: false, launchArgs: LAUNCH_ARGS });
  console.log(`🌐 ${picked.label}`);
  try {
    const page = await browser.newPage();
    await page.goto(START_URL, { waitUntil: 'networkidle2' });
    console.log('🔐 Log in if prompted — waiting for the chat box...');
    await page.waitForSelector(LOGGED_IN_SELECTOR, { timeout: LOGIN_TIMEOUT_MS });
    const cookies = await readAllCookies(page);
    fs.writeFileSync(cookiesFile, JSON.stringify(cookies, null, 2));
    console.log(`💾 ${cookies.length} cookies -> ${cookiesFile}`);
    console.log('   Copy this file to the headless host (same path, or set CHATGPT_COOKIES_FILE).');
  } finally {
    await browser.close();
  }
};

module.exports = { START_URL, delay, typeHuman, openAuthenticatedPage, runDumpCookies };
