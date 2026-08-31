// Browser resolution shared by any command that drives a real browser.
//
// Decides between a LOCAL Chromium-family browser (chrome / chromium / brave)
// and a REMOTE browserless.io endpoint, and connects to whichever it picked.
//
// Resolution order (first match wins):
//   1. AICLI_BROWSER=browserless (or opts.browser)        -> remote, needs a key
//   2. AICLI_BROWSER=<name|/abs/path> (or opts.browser)    -> that local browser
//   3. headless box (no DISPLAY/WAYLAND) + BROWSERLESS_API_KEY -> remote
//   4. the OS default browser, if it's Chromium-family     -> local
//   5. first local candidate found on PATH / known paths   -> local
//   6. BROWSERLESS_API_KEY is set                          -> remote
//   7. nothing usable                                      -> throw with guidance

const { execFileSync } = require('child_process');
const fs = require('fs');

// name -> candidate executables, most preferred first
const FAMILIES = {
  chrome: ['google-chrome-stable', 'google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'],
  chromium: ['chromium', 'chromium-browser', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
  brave: ['brave-browser', 'brave', '/usr/bin/brave-browser'],
};
// order tried when no explicit choice and no usable OS default
const AUTO_ORDER = ['chrome', 'chromium', 'brave'];

// map an xdg .desktop id to one of the family names above
const DESKTOP_TO_FAMILY = [
  [/google-chrome/i, 'chrome'],
  [/chromium/i, 'chromium'],
  [/brave/i, 'brave'],
];

const isHeadlessBox = () => !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;

const which = (cmd) => {
  if (cmd.includes('/')) return fs.existsSync(cmd) ? cmd : null;
  try {
    return execFileSync('command', ['-v', cmd], { shell: '/bin/bash', encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
};

const firstExecutable = (family) => {
  for (const cand of FAMILIES[family] || []) {
    const hit = which(cand);
    if (hit) return hit;
  }
  return null;
};

const osDefaultFamily = () => {
  try {
    const id = execFileSync('xdg-settings', ['get', 'default-web-browser'], { encoding: 'utf8' }).trim();
    for (const [re, family] of DESKTOP_TO_FAMILY) if (re.test(id)) return family;
  } catch {
    /* xdg-settings absent (typical on a headless box) */
  }
  return null;
};

const browserlessEndpoint = () => {
  const explicit = process.env.BROWSERLESS_WS_ENDPOINT;
  if (explicit) return explicit;
  const key = process.env.BROWSERLESS_API_KEY || process.env.BROWSERLESS_TOKEN;
  if (!key) return null;
  const base = (process.env.BROWSERLESS_URL || 'wss://production-sfo.browserless.io').replace(/\/+$/, '');
  return `${base}/chromium?token=${key}`;
};

// -> { mode: 'remote', wsEndpoint, label } | { mode: 'local', executablePath, label }
const resolveBrowser = (opts = {}) => {
  const choice = (opts.browser || process.env.AICLI_BROWSER || '').trim();
  const ws = browserlessEndpoint();

  if (choice.toLowerCase() === 'browserless') {
    if (!ws) throw new Error('AICLI_BROWSER=browserless but no BROWSERLESS_API_KEY / BROWSERLESS_WS_ENDPOINT is set.');
    return { mode: 'remote', wsEndpoint: ws, label: 'browserless.io (forced)' };
  }

  if (choice) {
    const exe = choice.includes('/') ? (fs.existsSync(choice) ? choice : null) : firstExecutable(choice);
    if (!exe) throw new Error(`AICLI_BROWSER="${choice}" not found (known names: chrome, chromium, brave, or an absolute path).`);
    return { mode: 'local', executablePath: exe, label: `${choice} (${exe})` };
  }

  if (isHeadlessBox() && ws) {
    return { mode: 'remote', wsEndpoint: ws, label: 'browserless.io (headless host)' };
  }

  const preferred = osDefaultFamily();
  if (preferred) {
    const exe = firstExecutable(preferred);
    if (exe) return { mode: 'local', executablePath: exe, label: `${preferred}, OS default (${exe})` };
  }

  for (const family of AUTO_ORDER) {
    const exe = firstExecutable(family);
    if (exe) return { mode: 'local', executablePath: exe, label: `${family} (${exe})` };
  }

  if (ws) return { mode: 'remote', wsEndpoint: ws, label: 'browserless.io (no local browser)' };

  throw new Error(
    isHeadlessBox()
      ? 'No local browser found and no BROWSERLESS_API_KEY set. On a headless host, set BROWSERLESS_API_KEY (see README).'
      : 'No Chromium-family browser found. Install one (e.g. `sudo apt install chromium-browser`) or set BROWSERLESS_API_KEY.'
  );
};

// Connect/launch per the resolution. `launchArgs` are passed to a local launch
// only. Pass a pre-resolved `opts.picked` to skip a second resolveBrowser().
const openBrowser = async (puppeteer, { userDataDir, headless = true, launchArgs = [] } = {}, opts = {}) => {
  const picked = opts.picked || resolveBrowser(opts);
  if (picked.mode === 'remote') {
    const browser = await puppeteer.connect({ browserWSEndpoint: picked.wsEndpoint });
    return { browser, picked };
  }
  const browser = await puppeteer.launch({
    executablePath: picked.executablePath,
    userDataDir,
    headless,
    args: launchArgs,
  });
  return { browser, picked };
};

module.exports = { resolveBrowser, openBrowser, isHeadlessBox, browserlessEndpoint };

// node bin/lib/browser.js --selftest
if (require.main === module && process.argv.includes('--selftest')) {
  const assert = require('assert');
  const famOf = (id) => {
    for (const [re, f] of DESKTOP_TO_FAMILY) if (re.test(id)) return f;
    return null;
  };
  assert.strictEqual(famOf('brave-browser.desktop'), 'brave');
  assert.strictEqual(famOf('google-chrome.desktop'), 'chrome');
  assert.strictEqual(famOf('chromium_chromium.desktop'), 'chromium');
  assert.strictEqual(famOf('firefox.desktop'), null);

  const saved = { ...process.env };
  delete process.env.BROWSERLESS_WS_ENDPOINT;
  delete process.env.BROWSERLESS_URL;
  process.env.BROWSERLESS_API_KEY = 'K';
  assert.strictEqual(browserlessEndpoint(), 'wss://production-sfo.browserless.io/chromium?token=K');
  process.env.BROWSERLESS_WS_ENDPOINT = 'wss://self.hosted/';
  assert.strictEqual(browserlessEndpoint(), 'wss://self.hosted/');
  delete process.env.BROWSERLESS_API_KEY;
  delete process.env.BROWSERLESS_WS_ENDPOINT;
  assert.strictEqual(browserlessEndpoint(), null);
  process.env = saved;

  console.log('selftest ok (desktop mapping + browserless endpoint)');
}
