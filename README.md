# ai-cli toolbox

Terminal commands for AI/media workflows: drives Chrome (via a persistent profile + puppeteer-core, for ChatGPT) or `gallery-dl` (for Instagram) using the browser's already-authenticated sessions instead of reinventing login/scraping, plus a set of `ffmpeg`-based video utilities.

## Commands

### `chatgpt-image`
Uploads an image to ChatGPT with a prompt and downloads the resulting generated image.

```
chatgpt-image --image ./photo.jpg --prompt "make the background blue"
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `--image` | yes | file path | image to upload (relative or absolute) |
| `--prompt` | yes | string | prompt text sent to ChatGPT |
| `--help` / `-h` | no | — | print usage and exit |

- Auth: uses a dedicated, persistent Chrome profile at `bin/chrome-profile-chatgpt/`. It first tries headless; if the login cookie is missing/expired, it closes the headless browser, opens a **visible** Chrome window, and waits up to 5 minutes for you to log in by hand, then continues automatically.
- Output: saved next to the input file as `<input-name>-mod.<ext>` (e.g. `photo-mod.png`).

### `instagram-download`
Downloads a single Instagram reel, post, or photo.

```
instagram-download https://www.instagram.com/reel/XXXX/
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `<url>` | yes | Instagram post/reel URL | positional argument, first non-flag arg |
| `--help` / `-h` | no | — | print usage and exit |

- Auth: shells out to `gallery-dl --cookies-from-browser chrome`, which reads cookies straight from your everyday, already-logged-in default Chrome profile. No separate login flow to manage.
- Output: saved in the current directory as `username-publishTimestamp_num.ext` (e.g. `someuser-20260101T120000_1.mp4`); `_num` only matters for multi-image carousel posts, it's always `1` for reels and single photos. Uses the content's publish date, not the download date.

### `instagram-download-batch`
Downloads every post and story highlight from an Instagram profile.

```
instagram-download-batch someusername
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `<username-or-url>` | yes | username or full profile URL | positional argument, first non-flag arg |
| `--help` / `-h` | no | — | print usage and exit |

- Auth: same as `instagram-download` (`--cookies-from-browser chrome`).
- Output: saves into an `instagram/` subfolder in the current directory (shared across all profiles, not one folder per profile), files named the same way as `instagram-download`. Keeps an `instagram/.downloaded.sqlite3` archive so reruns skip posts already downloaded.

### `tiktok-download`
Downloads a single TikTok video or photo post.

```
tiktok-download https://www.tiktok.com/@someuser/video/XXXX
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `<url>` | yes | TikTok video/photo URL | positional argument, first non-flag arg |
| `--help` / `-h` | no | — | print usage and exit |

- Auth: shells out to `gallery-dl --cookies-from-browser chrome`, same as the Instagram commands. TikTok's public posts often work without cookies, but logged-in cookies help with region-locked or otherwise gated content.
- Output: saved in the current directory as `user-publishTimestamp_num.ext` (e.g. `someuser-20260101T120000_1.mp4`); `_num` only matters for multi-image posts.

### `tiktok-download-batch`
Downloads every post from a TikTok profile.

```
tiktok-download-batch someusername
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `<username-or-url>` | yes | username or full profile URL | positional argument, first non-flag arg |
| `--help` / `-h` | no | — | print usage and exit |

- Auth: same as `tiktok-download` (`--cookies-from-browser chrome`).
- Output: saves into a `tiktok/` subfolder in the current directory (shared across all profiles, not one folder per profile), files named the same way as `tiktok-download`. Keeps a `tiktok/.downloaded.sqlite3` archive so reruns skip posts already downloaded.

### `get-first-frame`
Extracts the first frame of a video as a JPEG.

```
get-first-frame ./input.mp4
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `<input>` | yes | video file path | positional argument, first non-flag arg |
| `--help` / `-h` | no | — | print usage and exit |

- Wraps `ffmpeg -i input.mp4 -frames:v 1 output.jpg`.
- Output: saved next to the input file as `<input-name>-first-frame.jpg`.

### `get-last-frame`
Extracts the last frame of a video as a JPEG.

```
get-last-frame ./input.mp4
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `<input>` | yes | video file path | positional argument, first non-flag arg |
| `--help` / `-h` | no | — | print usage and exit |

- Wraps `ffmpeg -sseof -3 -i input.mp4 -update 1 -q:v 2 output.jpg` (seeks to 3s before end and keeps re-decoding until the last frame, since videos don't always have a keyframe exactly at EOF).
- Output: saved next to the input file as `<input-name>-last-frame.jpg`.

### `blur-video`
Blurs a video from a given second to the end, in two ramping phases (medium blur for 4s, then heavy blur for the rest).

```
blur-video --at 19 ./input.mp4
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `<input>` | yes | video file path | positional argument, first non-flag arg |
| `--at` | yes | seconds (number) | second the blur starts at |
| `--help` / `-h` | no | — | print usage and exit |

- Wraps `ffmpeg -vf "boxblur=25:1:enable='between(t,AT,AT+4)',boxblur=50:1:enable='gte(t,AT+4)'" -c:v libx264 -crf 18 -an`.
- The 4s ramp is currently hardcoded (matches the original 19→23 example); re-encodes video (`libx264`, `crf 18`), drops audio.
- Output: saved next to the input file as `<input-name>-blurred.<ext>`.

### `text-overlay`
**Placeholder/stub** — currently always draws "hello world" centered on screen for the first 3 seconds, regardless of input. Not yet configurable.

```
text-overlay ./input.mp4
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `<input>` | yes | video file path | positional argument, first non-flag arg |
| `--help` / `-h` | no | — | print usage and exit |

- Wraps `ffmpeg -vf "drawtext=text='hello world':...:enable='between(t,0,3)'" -c:v libx264 -crf 18 -an`.
- TODO: add `--text` / `--start` / `--end` flags once real requirements are known.
- Output: saved next to the input file as `<input-name>-overlay.<ext>`.

### `share-qr`
Prints a QR code for arbitrary text (e.g. a Wi-Fi password) directly in the terminal. Pass `--out` to save it as a PNG file instead.

```
share-qr 'some text with special chars like $ @ # !'
share-qr 'some text' --out wifi.png
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `<text>` | yes | string | positional argument, first non-flag arg |
| `--out` | no | file path | save as PNG instead of printing to terminal |
| `--help` / `-h` | no | — | print usage and exit |

- No `--out`: wraps `qrencode -t ANSIUTF8 -l H <text>` (prints to terminal, nothing saved to disk).
- With `--out file.png`: wraps `qrencode -o file.png -s 10 -l H <text>`.
- Text is passed straight to `qrencode` as a single argument (no shell involved), so special characters like `$ @ # ' "` don't need any escaping — just quote the whole argument in your shell (single quotes `'...'` are safest, they stop your shell from expanding `$vars` before the command ever sees them).

### `search-string`
Searches file names and file content for a string in a directory (recursive, `.git` and `node_modules` excluded).

```
search-string sometext
search-string sometext --case true --directory ~/foo/bar
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `<string>` | yes | string | positional argument, first non-flag arg |
| `--case` | no | `true` \| `false` | case-sensitive search (default: `false`) |
| `--directory` | no | directory path (`~` expanded) | directory to search (default: current directory) |
| `--help` / `-h` | no | — | print usage and exit |

- Wraps `find -iname`/`-name` (file names) and `grep -rn -I`/`-i` (file content, binary files skipped).

### `ai-cli`
Lists all commands in this toolbox with a short description.

```
ai-cli --help
```

All twelve commands support `--help` / `-h`. `get-first-frame`, `get-last-frame`, `blur-video`, and `text-overlay` additionally require `ffmpeg` on `PATH` (`sudo apt install ffmpeg`). `share-qr` requires `qrencode` on `PATH` (`sudo apt install qrencode`). `search-string` requires `find` and `grep` on `PATH` (present by default on Linux).

## Setup from scratch (to replicate on a VPS)

1. **Node.js + npm** (via nvm, recommended):
   ```
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
   nvm install --lts
   ```

2. **Copy this folder** to the target machine (`package.json` + the `.js` scripts; `node_modules/` doesn't need to be copied, `npm install` rebuilds it).

3. **Install npm dependencies and register the global commands**:
   ```
   cd ai-cli
   npm install
   npm link
   ```
   After `npm link`, all ten commands listed above are available from any directory (as long as the shell's `PATH` includes the npm global bin dir — true by default).

4. **Chrome browser**:
   ```
   sudo apt install google-chrome-stable
   ```
   (or follow Google's official install guide if the apt repo isn't set up).

5. **gallery-dl**, via `pipx` (isolated from system Python, easy to upgrade):
   ```
   sudo apt install pipx
   pipx install gallery-dl
   pipx inject gallery-dl secretstorage   # required to decrypt Chrome's cookie store on Linux
   pipx ensurepath   # makes sure ~/.local/bin is on PATH, then reopen the shell
   ```
   To upgrade later: `pipx upgrade gallery-dl`.

   Note: `yt-dlp` was tried first (it's the better-known tool), but its Instagram extractors (both single-post and profile listing) are currently broken upstream — confirmed on the latest version. `gallery-dl` handles photos, reels, and profile batches correctly as of this writing.

6. **Authentication**:
   - `chatgpt-image` uses a dedicated, persistent Chrome profile at `bin/chrome-profile-chatgpt/` (created automatically on first run). If that profile isn't logged in, the script opens a **visible** Chrome window and waits up to 5 minutes for you to log in by hand, then carries on by itself. **This headful fallback doesn't work on a display-less VPS.** Practical workaround: do the first login on a machine with a screen, then copy the whole `bin/chrome-profile-chatgpt/` folder to the VPS — headless mode alone is enough from there on.
   - `instagram-download*` and `tiktok-download*` use `gallery-dl --cookies-from-browser chrome`, which reads cookies from the system's *default* Chrome profile (the one you use daily, already logged into Instagram/TikTok). Without `secretstorage` installed (step 5), cookie decryption silently fails for most cookies and requests get redirected to the login page even though you're actually logged in in Chrome — if you see login-redirect errors, check that `secretstorage` is injected into the `gallery-dl` pipx venv. **`--cookies-from-browser` also doesn't work out of the box on a display-less VPS with no locally logged-in Chrome.** Practical workaround: export cookies from your local Chrome into a `cookies.txt` file (e.g. with the "Get cookies.txt LOCALLY" extension), copy it to the VPS, and swap `--cookies-from-browser chrome` for `--cookies /path/to/cookies.txt` in the scripts — not implemented yet, do this if/when the VPS move actually happens.

## Repo structure

```
ai-cli/
├── bin/
│   ├── chatgpt-image.js            # command: chatgpt-image
│   ├── instagram-download.js       # command: instagram-download
│   ├── instagram-download-batch.js # command: instagram-download-batch
│   ├── tiktok-download.js          # command: tiktok-download
│   ├── tiktok-download-batch.js    # command: tiktok-download-batch
│   ├── get-first-frame.js          # command: get-first-frame
│   ├── get-last-frame.js           # command: get-last-frame
│   ├── blur-video.js                # command: blur-video
│   ├── text-overlay.js              # command: text-overlay (placeholder/stub)
│   ├── share-qr.js                  # command: share-qr
│   ├── search-string.js             # command: search-string
│   ├── ai-cli.js                    # command: ai-cli (lists all commands)
│   └── chrome-profile-chatgpt/     # persistent Chrome profile (ChatGPT login cookies) — don't commit this
├── package.json
└── README.md
```
