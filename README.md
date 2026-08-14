# ai-cli toolbox

Terminal commands for AI/media workflows: drives Brave (via a persistent profile + puppeteer-core, for ChatGPT) or `gallery-dl` (for Instagram) using the browser's already-authenticated sessions instead of reinventing login/scraping, plus a set of `ffmpeg`-based video utilities.

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

- Auth: uses a dedicated, persistent Brave profile at `brave-profile-chatgpt/`. It first tries headless; if the login cookie is missing/expired, it closes the headless browser, opens a **visible** Brave window, and waits up to 5 minutes for you to log in by hand, then continues automatically.
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

- Auth: shells out to `gallery-dl --cookies-from-browser brave`, which reads cookies straight from your everyday, already-logged-in default Brave profile. No separate login flow to manage.
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

- Auth: same as `instagram-download` (`--cookies-from-browser brave`).
- Output: creates a `<username>/` subfolder in the current directory, files named the same way as `instagram-download`. Keeps a `<username>/.downloaded.sqlite3` archive so reruns skip posts already downloaded.

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

All seven commands support `--help` / `-h`. `get-first-frame`, `get-last-frame`, `blur-video`, and `text-overlay` additionally require `ffmpeg` on `PATH` (`sudo apt install ffmpeg`).

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
   After `npm link`, all seven commands listed above are available from any directory (as long as the shell's `PATH` includes the npm global bin dir — true by default).

4. **Brave browser**:
   ```
   sudo apt install brave-browser
   ```
   (or follow Brave's official install guide if the apt repo isn't set up).

5. **gallery-dl**, via `pipx` (isolated from system Python, easy to upgrade):
   ```
   sudo apt install pipx
   pipx install gallery-dl
   pipx inject gallery-dl secretstorage   # required to decrypt Brave's cookie store on Linux
   pipx ensurepath   # makes sure ~/.local/bin is on PATH, then reopen the shell
   ```
   To upgrade later: `pipx upgrade gallery-dl`.

   Note: `yt-dlp` was tried first (it's the better-known tool), but its Instagram extractors (both single-post and profile listing) are currently broken upstream — confirmed on the latest version. `gallery-dl` handles photos, reels, and profile batches correctly as of this writing.

6. **Authentication**:
   - `chatgpt-image` uses a dedicated, persistent Brave profile at `brave-profile-chatgpt/` (created automatically on first run). If that profile isn't logged in, the script opens a **visible** Brave window and waits up to 5 minutes for you to log in by hand, then carries on by itself. **This headful fallback doesn't work on a display-less VPS.** Practical workaround: do the first login on a machine with a screen, then copy the whole `brave-profile-chatgpt/` folder to the VPS — headless mode alone is enough from there on.
   - `instagram-download*` use `gallery-dl --cookies-from-browser brave`, which reads cookies from the system's *default* Brave profile (the one you use daily, already logged into Instagram). Without `secretstorage` installed (step 5), cookie decryption silently fails for most cookies and Instagram requests get redirected to the login page even though you're actually logged in in Brave — if you see login-redirect errors, check that `secretstorage` is injected into the `gallery-dl` pipx venv. **`--cookies-from-browser` also doesn't work out of the box on a display-less VPS with no locally logged-in Brave.** Practical workaround: export Instagram's cookies from your local Brave into a `cookies.txt` file (e.g. with the "Get cookies.txt LOCALLY" extension), copy it to the VPS, and swap `--cookies-from-browser brave` for `--cookies /path/to/cookies.txt` in the scripts — not implemented yet, do this if/when the VPS move actually happens.

## Repo structure

```
ai-cli/
├── chatgpt-image.js            # command: chatgpt-image
├── instagram-download.js       # command: instagram-download
├── instagram-download-batch.js # command: instagram-download-batch
├── get-first-frame.js          # command: get-first-frame
├── get-last-frame.js           # command: get-last-frame
├── blur-video.js                # command: blur-video
├── text-overlay.js              # command: text-overlay (placeholder/stub)
├── brave-profile-chatgpt/      # persistent Brave profile (ChatGPT login cookies) — don't commit this
├── package.json
└── README.md
```
