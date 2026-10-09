# ai-cli toolbox

Terminal commands for AI/media workflows: drives a local Chromium-family browser or a remote browserless.io instance (via puppeteer-core, for ChatGPT) or `gallery-dl` (for Instagram/TikTok/X) using already-authenticated sessions instead of reinventing login/scraping, plus a set of `ffmpeg`/ImageMagick-based image and video utilities.

## Commands

Commands are grouped by area, one folder per area under `bin/`. `ai-cli --help` prints the same list.

### `ai-cli`
Lists all commands in this toolbox with a short description.

```
ai-cli --help
ai-cli doctor    # which browser chatgpt-image would use here (local family / browserless / none)
```


## ai

AI-driven image work: ChatGPT automation, face restoration, face redaction.

### `ai`
One entry point for the toolbox: a remote model answers a prompt, or `local` runs one of the CPU tools of this repo. v0 of the AI router: the target is picked by hand; routing decisions move to Laya later.

```
ai claude "summarize this repo"       # Claude Code, headless (claude -p)
ai grok "summarize this repo"         # Grok, headless (grok -p)
ai deepseek "explain MoE in 3 lines"  # DeepSeek via NVIDIA's free API
ai local upscale photo.jpg            # any command of this toolbox
ai l u photo.jpg                      # same, abbreviated
ai l                                  # list the local commands
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `<target>` | yes | `claude` / `grok` / `deepseek` / `local` | who runs it |
| `<prompt...>` | yes, remote targets | string | the rest of the arguments, joined with spaces |
| `<command> [args...]` | `local` only | a command below + its own args | passed through unchanged, so `ai l <command> --help` works |
| `--help` / `-h` | no | — | print usage and exit |

- **Abbreviations**: every target and local command accepts any unique prefix: one letter when it is enough (`c`, `g`, `d`, `l`, `u`), more when names share a start (`ai l sl` = `slideshow`, `ai l gitp` = `gitpush`). An exact name always wins (`instagram-download` vs `instagram-download-batch`). Ambiguous or unknown names print the candidates.
- `ai local` reads the command list from `package.json` `bin`, so new commands show up without touching `ai`. The standalone names (`upscale`, `gitpush`, ...) keep working.
- `claude` and `grok` run the installed CLIs with `-p`, using their own login. Output and exit code are theirs.
- `deepseek` calls `https://integrate.api.nvidia.com/v1` (OpenAI-compatible) through the Vercel AI SDK and streams the answer. Needs `NVIDIA_API_KEY` (shell env or `.env`); model from `AI_DEEPSEEK_MODEL`, default `deepseek-ai/deepseek-v4.1-flash`. Free tier, for trials only: ~40 requests/min, can queue for minutes when busy.

### `chatgpt-image`
Uploads an image to ChatGPT with a prompt and downloads the resulting generated image.

```
chatgpt-image --image ./photo.jpg --prompt "make the background blue"
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `--image` | yes* | file path | image to upload (relative or absolute) |
| `--prompt` | yes* | string | prompt text sent to ChatGPT |
| `--dump-cookies` | no | — | local login only: save `chatgpt-cookies.json` for use on a headless host, then exit |
| `--help` / `-h` | no | — | print usage and exit |

*not required with `--dump-cookies`.

- **Browser**: auto-detected — the OS default browser if it's Chromium-family, else `chrome`, `chromium`, `brave` in that order. Override with `AICLI_BROWSER=chrome|chromium|brave|/abs/path`. On a headless host (no `DISPLAY`) with `BROWSERLESS_API_KEY` set, it connects to browserless.io instead. `AICLI_BROWSER=browserless` forces that anywhere. Run `ai-cli doctor` to see the current pick. Full setup (browserless key, cookie workflow) in step 4 below.
- **Auth (local browser)**: a dedicated persistent profile at `bin/ai/chrome-profile-chatgpt/`. Tries headless first; if not logged in it opens a **visible** window and waits up to 5 minutes for a hand login, then continues.
- **Auth (browserless / headless)**: no persistent profile is possible over a remote connection, so it loads `bin/ai/chatgpt-cookies.json` (generate it on a desktop with `chatgpt-image --dump-cookies`, copy it over, or point `CHATGPT_COOKIES_FILE` elsewhere). Stale/missing cookies fail with an explicit message.
- Output: saved next to the input file as `<input-name>-mod.<ext>` (e.g. `photo-mod.png`).

### `create-virtual-ambassador`
Uploads every image in a folder to ChatGPT in one message with a fixed prompt asking for three full-body avatar variants derived from them, and saves each — built to turn a hand-picked shortlist of reference photos into a set of usable avatar candidates.

```
create-virtual-ambassador                    # uploads everything in ./references
create-virtual-ambassador ./some-photos
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `[images-dir]` | no | folder of images | positional argument, first non-flag arg — defaults to `./references` |
| `--dump-cookies` | no | — | local login only: save `chatgpt-cookies.json` for use on a headless host, then exit |
| `--help` / `-h` | no | — | print usage and exit |

- Shares its ChatGPT login/session (`bin/ai/chrome-profile-chatgpt/`, `bin/ai/chatgpt-cookies.json`) with `chatgpt-image` — see that section above for the browser/auth details, identical here.
- Prompt sent (fixed, not configurable): asks for three separate full-body, 1:1, transparent-background images derived from the references — (1) near-identical to the original, (2) resembling but not the same person, (3) only loosely inspired (broad traits kept, different face/identity). One line, no literal newlines — `page.type()` presses a real Enter for `\n`, which would submit the message mid-prompt.
- Output: `avatar/genesis-identical.<ext>`, `avatar/genesis-resembling.<ext>`, `avatar/genesis-inspired.<ext>` under the **current directory** (not `[images-dir]`) — extension follows whatever ChatGPT returns (typically `.png`). If ChatGPT returns a different number of images than three, they're saved as `avatar/genesis-1.<ext>`, `genesis-2.<ext>`, ... instead, since the identical/resembling/inspired labels only apply when the count matches the prompt's 3-item list.
- **Scoring**: each saved variant is then compared against a reference photo via the free tool at `quantilence.com/products/face-similarity` (browser-automated, no API key), and the match percentage is appended to its filename (e.g. `genesis-identical-94.png`). The reference photo is the first `profile.*` found checking, in order, `<cwd>/web/`, `<cwd>/instagram/`, `<cwd>/tiktok/`, `<cwd>/x/` (the layout `*-download-batch` produces). No reference found → scoring is skipped, filenames stay unscored. That site's comparison endpoint is rate-limited; a 429 gets one retry after a 20s wait, then scoring is skipped for that image only (the generated avatar is kept either way — a failed score never discards the image).
- If ChatGPT refuses on content-guideline grounds (nudity/sexuality/erotic content), this has no way to tell which of the uploaded images triggered it — it prints the refusal and the list of uploaded files so you can remove the suspect one by hand and try again. No automatic retry.

### `enhance-face`

Restores facial detail on a low-res or compressed portrait with GFPGAN v1.4 (CPU only), optionally upscaling the background with Real-ESRGAN. Unlike `upscale`, it rebuilds detail instead of just adding pixels.

```
enhance-face ./portrait.jpg              # 2x -> portrait@2x-face.jpg
enhance-face --scale 4 ./portrait.jpg
enhance-face --bg ./portrait.jpg         # also upscale the background (much slower)
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `<input>` | yes | image file (jpg/png/webp) | positional argument |
| `--scale` | no | integer > 1 | output size factor (default: `2`) |
| `--bg` | no | — | also upscale the background with Real-ESRGAN x2 (needs `WITH_BG=1` at setup) |
| `--help` / `-h` | no | — | print usage and exit |

- Needs a one-time setup of ~2 GB (CPU torch, GFPGAN, weights): `./install.sh --with-face`, or `bin/ai/enhance-face-setup.sh` directly. Add `WITH_BG=1` before it to also fetch the Real-ESRGAN weights for `--bg`.
- The venv and the weights live outside the repo, in `$ENHANCE_FACE_HOME` (default `~/.local/share/peaha-face`). Only the scripts are versioned.
- Output: `<name>@<N>x-face.<ext>` next to the input; the original is never touched.

### `redact-faces`
Blurs/redacts faces in an image or video via the Sightengine API (image vs video auto-detected from the file extension).

```
redact-faces --api-user U --api-secret S ./photo.jpg
redact-faces ./input.mp4   # if SIGHTENGINE_USER / SIGHTENGINE_SECRET are set
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `<input>` | yes | image or video file path | positional argument, first non-flag arg |
| `--api-user` | no* | string | Sightengine API user |
| `--api-secret` | no* | string | Sightengine API secret |
| `--help` / `-h` | no | — | print usage and exit |

*`--api-user`/`--api-secret` are required one way or another — either as flags, or via the `SIGHTENGINE_USER`/`SIGHTENGINE_SECRET` env vars (flags take precedence).

- Images: single synchronous call to Sightengine's Image Redaction API (`transform.json`).
- Videos: submits to the Video Redaction API (`video/transform.json`), then polls `video/byid.json` every 2s for up to 30 attempts (~1 minute) until the transform finishes, then downloads the result.
- Output: saved next to the input file as `<input-name>-redacted.<ext>`.

## social

Downloaders for Instagram, TikTok and X, via `gallery-dl` and your logged-in Chrome cookies.

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
- Output: saves into an `instagram/` subfolder in the current directory (shared across all profiles, not one folder per profile), files named like `instagram-download` plus the gallery-dl subcategory after the user (`posts`, `highlights`, `avatar`, ...), which is how the avatar is recognised. Keeps an `instagram/.downloaded.sqlite3` archive so reruns skip posts already downloaded.
- After each run, images are moved into `instagram/img/` and reels/videos into `instagram/vid/` (flattening any per-highlight subfolder gallery-dl created), regardless of exit status — so a partial download still gets sorted.
- Also downloads the profile's current avatar to `instagram/profile.<ext>` — used as a reference photo (e.g. for `create-virtual-ambassador`'s face-similarity scoring).

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
- Output: saves into a `tiktok/` subfolder in the current directory (shared across all profiles, not one folder per profile), files named like `tiktok-download` plus the gallery-dl subcategory after the user (`posts`, `highlights`, `avatar`, ...), which is how the avatar is recognised. Keeps a `tiktok/.downloaded.sqlite3` archive so reruns skip posts already downloaded.
- After each run, images are moved into `tiktok/img/` and videos into `tiktok/vid/`, regardless of exit status — so a partial download still gets sorted.
- Also downloads the profile's current avatar to `tiktok/profile.<ext>` — used as a reference photo (e.g. for `create-virtual-ambassador`'s face-similarity scoring).

### `x-download`
Downloads a single X (Twitter) post's media.

```
x-download https://x.com/someuser/status/XXXX
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `<url>` | yes | X/Twitter post URL | positional argument, first non-flag arg |
| `--help` / `-h` | no | — | print usage and exit |

- Auth: shells out to `gallery-dl --cookies-from-browser chrome`, same as the other platform commands.
- Output: saved in the current directory as `handle-publishTimestamp_num.ext`; `_num` only matters for multi-image posts.

### `x-download-batch`
Downloads every media post from an X (Twitter) profile — text-only posts and replies without a photo/video are skipped entirely (gallery-dl's own "media" tab filter, not a client-side one).

```
x-download-batch someusername
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `<username-or-url>` | yes | username or full profile URL | positional argument, first non-flag arg |
| `--help` / `-h` | no | — | print usage and exit |

- Auth: same as `x-download` (`--cookies-from-browser chrome`).
- Output: saves into an `x/` subfolder in the current directory (shared across all profiles, not one folder per profile), files named like `x-download` plus the gallery-dl subcategory after the user (`posts`, `highlights`, `avatar`, ...), which is how the avatar is recognised. Keeps an `x/.downloaded.sqlite3` archive so reruns skip posts already downloaded.
- After each run, images are moved into `x/img/` and videos into `x/vid/`, regardless of exit status — so a partial download still gets sorted.
- Also downloads the profile's current avatar to `x/profile.<ext>` — used as a reference photo (e.g. for `create-virtual-ambassador`'s face-similarity scoring).

## media

Image and video utilities on `ffmpeg`, ImageMagick and `sharp`.

### `image-to-jpg`
One command for any supported source format, dispatched by file extension — same behaviour as `webp-to-jpg` / `heic-to-jpg`, just picked automatically. Currently supports `.webp`, `.heic`, `.heif`, `.avif`; a folder input can mix formats freely.

```
image-to-jpg ./photo.webp               # -> photo.jpg, photo.webp deleted
image-to-jpg ./IMG_0001.heic            # -> IMG_0001.jpg, IMG_0001.heic deleted
image-to-jpg --keep ./photo.heic        # -> photo.jpg, photo.heic preserved
image-to-jpg ./camera-roll              # every supported file in the folder -> .jpg
image-to-jpg                            # every supported file in the current folder -> .jpg
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `[input]` | no | supported image file **or** folder of them | positional argument, first non-flag arg — defaults to `.` (current folder) |
| `--quality` | no | 1-100 | JPEG output quality — ImageMagick-based formats only (`.heic`/`.heif`/`.avif`); ignored for `.webp` (default: `92`) |
| `--keep` | no | — | keep the original file(s) instead of deleting them |
| `--help` / `-h` | no | — | print usage and exit |

- Extensions are looked up in a `CONVERTERS` map at the top of `bin/media/image-to-jpg.js` — adding a new source format later means adding one entry there, nothing else changes.
- Output: `<name>.jpg` next to the input, in the same folder. By default the original is deleted after a successful conversion — pass `--keep` to preserve it. An existing `<name>.jpg` is never overwritten: that input is skipped and left in place, and the command exits 1.

### `heic-to-jpg`
Converts an iPhone `.heic`/`.heif` image, or every one in a folder, to `.jpg`.

```
heic-to-jpg ./IMG_0001.heic             # -> IMG_0001.jpg
heic-to-jpg --quality 85 ./photo.heic   # -> photo.jpg, quality 85
heic-to-jpg ./camera-roll               # every .heic/.heif in the folder -> .jpg
heic-to-jpg                             # every .heic/.heif in the current folder -> .jpg
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `[input]` | no | `.heic`/`.heif` file **or** folder of them | positional argument, first non-flag arg — defaults to `.` (current folder) |
| `--quality` | no | 1-100 | JPEG output quality (default: `92`) |
| `--keep` | no | — | keep the original `.heic`/`.heif` file(s) instead of deleting them |
| `--help` / `-h` | no | — | print usage and exit |

- Wraps `convert <in> -auto-orient -quality N <out.jpg>` — `-auto-orient` bakes in the EXIF rotation iPhone HEIC files carry, so the JPEG isn't sideways.
- Output: `<name>.jpg` next to the input, in the same folder. By default the original is deleted after a successful conversion — pass `--keep` to preserve it. An existing `<name>.jpg` is never overwritten: that input is skipped and left in place, and the command exits 1.

### `webp-to-jpg`
Converts a `.webp` image, or every one in a folder, to `.jpg`.

```
webp-to-jpg ./photo.webp                # -> photo.jpg, photo.webp deleted
webp-to-jpg --keep ./photo.webp         # -> photo.jpg, photo.webp preserved
webp-to-jpg ./icons                     # every .webp in the folder -> .jpg
webp-to-jpg                             # every .webp in the current folder -> .jpg
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `[input]` | no | `.webp` file **or** folder of them | positional argument, first non-flag arg — defaults to `.` (current folder) |
| `--keep` | no | — | keep the original `.webp` file(s) instead of deleting them |
| `--help` / `-h` | no | — | print usage and exit |

- Wraps `ffmpeg -i <in> <out.jpg>`.
- Output: `<name>.jpg` next to the input, in the same folder. By default the original is deleted after a successful conversion — pass `--keep` to preserve it. An existing `<name>.jpg` is never overwritten: that input is skipped and left in place, and the command exits 1.
- Ported from a `webptojpg()` bash function that used to live in `~/.bashrc` (removed from there — this is now the canonical version).

### `upscale`
Resamples an image, or every image in a folder, up by an integer factor.

```
upscale ./frame.png                     # 2x, -> frame@2x.png
upscale --scale 3 ./frame.png           # 3x, -> frame@3x.png
upscale ./animation-frames              # 2x every image -> animation-frames@2x/
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `<input>` | yes | image file **or** folder of images | positional argument, first non-flag arg |
| `--scale` | no | integer > 1 | resize factor per side (default: `2`) |
| `--help` / `-h` | no | — | print usage and exit |

- Wraps `convert <in> -colorspace RGB -filter Lanczos -resize <N*100>% -colorspace sRGB -unsharp 0x0.75+0.6+0.008 -strip <out>` — resize is done in linear light, with a light sharpen pass to counter the softening.
- This is a plain resample: more pixels, **no invented detail**. For a genuine ML upscale (sharper skin/hair/edges) install `realesrgan-ncnn-vulkan` and run that instead.
- Recognised image extensions: `.jpg .jpeg .png .webp .bmp .tif .tiff`. A folder input skips everything else.
- Output: a file becomes `<name>@<N>x.<ext>` next to the input; a folder fans out to a sibling `<folder>@<N>x/` with the same file names. Originals are never touched.

### `watermark-image`
Tiles a rotated (-45°) diagonal text watermark over an image.

```
watermark-image --text "ondanovia.com" ./photo.jpg
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `<input>` | yes | image file path | positional argument, first non-flag arg |
| `--text` | yes | string | watermark text |
| `--opacity` | no | 0–1 | watermark opacity (default: `0.25`) |
| `--font-size` | no | number | watermark font size in px (default: `36`) |
| `--help` / `-h` | no | — | print usage and exit |

- Renders the text as a rotated SVG, tiled at a fixed 256×256px repeat over the full image via `sharp`.
- Output: saved next to the input file as `<input-name>-watermarked.<ext>`.

### `text-overlay`
Draws a single line of text over an image or a video (input type auto-detected from the file extension).

```
text-overlay --text "Ma se sbagli: 50% di tasse" ./photo.jpg
text-overlay --text "hello" --position bottom --start 0 --end 3 ./input.mp4
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `<input>` | yes | image or video file path | positional argument, first non-flag arg |
| `--text` | yes | string | text to draw (or set env `TEXT_OVERLAY_TEXT`) |
| `--position` | no | `top` \| `center` \| `bottom` | vertical placement, always horizontally centered (default: `top`) |
| `--fontsize` | no | number | font size in px (default: `48`) |
| `--color` | no | ffmpeg color name or `#hex` | font color (default: `white`) |
| `--start` | no | seconds | video only: when the text appears (default: `0`) |
| `--end` | no | seconds | video only: when the text disappears (default: end of clip) |
| `--help` / `-h` | no | — | print usage and exit |

- Text is always drawn with a 2px black border for legibility. `--start`/`--end` are ignored for images (the overlay is permanent).
- Passed to `drawtext` via a temp `textfile` with `expansion=none`, so `:` `%` `'` `,` in the text need no escaping and don't trigger drawtext's `%{...}` expansion.
- Images: `ffmpeg -i in -vf drawtext=... -q:v 2 out` (single frame, quality preserved). Videos: adds `enable='between(t,start,end)'`, re-encodes `libx264 -crf 18`, drops audio (`-an`).
- Output: saved next to the input file as `<input-name>-overlay.<ext>`.

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

### `watermark-video`
Tiles the same rotated diagonal text watermark over every frame of a video.

```
watermark-video --text "ondanovia.com" ./input.mp4
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `<input>` | yes | video file path | positional argument, first non-flag arg |
| `--text` | yes | string | watermark text |
| `--opacity` | no | 0–1 | watermark opacity (default: `0.25`) |
| `--font-size` | no | number | watermark font size in px (default: `36`) |
| `--help` / `-h` | no | — | print usage and exit |

- Extracts the first frame (`ffmpeg`) to get the video's real pixel size, builds a full-frame transparent PNG tiled with the watermark (tile scaled to ~1/3 of the frame width/height, via `sharp`), then overlays it onto every frame (`ffmpeg -filter_complex overlay`, audio copied through untouched).
- Re-encodes video only (`libx264` default from ffmpeg's overlay output); this is CPU-bound and can be slow/heavy on long or high-resolution videos on a laptop — GPU-accelerated encoding is a possible future addition, not implemented yet.
- Output: saved next to the input file as `<input-name>-watermarked.<ext>`.

### `slideshow`
Turns the images and videos of a folder, or an explicit list of files, into one silent mp4: images held for `--duration` seconds, videos merged in full.

```
slideshow                               # every image/video in the current folder -> ./slideshow.mp4
slideshow ./photos                      # every image/video in ./photos -> ./photos/slideshow.mp4
slideshow c.jpg intro.mp4 a.jpg b.png   # exactly these, in this order -> ./slideshow.mp4
slideshow --fill ./photos               # fill the frame, cropping around the subject
slideshow --ratio 9:16 --fill ./photos     # vertical, for Reels/TikTok/Stories
slideshow --duration 2 --ratio 16:9 --output reel.mp4 ./photos
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `[input]` | no | nothing, **one** folder, **or** one or more image/video files | no input = current folder; a folder = all its images and videos, natural-sorted (`img2` before `img10`); files = that exact order |
| `--duration` | no | seconds (number) | how long each image stays on screen; videos always play in full (default: `3`) |
| `--ratio` | no | `W:H` | aspect ratio of the output, e.g. `1:1`, `16:9`, `9:16`, `4:3`, `3:4`; the short side is always 1080 px (`16:9` → 1920x1080, `4:3` → 1440x1080) (default: `1:1`) |
| `--fill` | no | — | fill the whole frame instead of letterboxing: images are cover-cropped with `sharp` attention (a heuristic, it can miss the subject, see below), videos are center-cropped |
| `--output` | no | file path | output mp4 (default: `<folder>/slideshow.mp4` for a folder, `./slideshow.mp4` for a file list) |
| `--help` / `-h` | no | — | print usage and exit |

- Accepted images: `.jpg`, `.jpeg`, `.png`, `.webp`, `.bmp`, `.tif`, `.tiff`; convert `.heic`/`.avif` first with `image-to-jpg --keep`. Accepted videos: `.mp4`, `.mov`, `.m4v`, `.webm`, `.mkv`.
- Default framing: each input is fitted inside the `--ratio` frame and letterboxed with black bars, never cropped or stretched.
- Images are pre-processed with `sharp`, one at a time: the EXIF orientation is always applied (ffmpeg 4.4 ignores it, so phone photos rotated only in metadata would come out sideways); images without an orientation tag go to ffmpeg untouched.
- `--fill`: the same `sharp` pass crops each image to exactly the `--ratio` frame with `position: 'attention'` (sharp's saliency strategy: luminance frequency, colour saturation, presence of skin tones); videos get a plain center crop in ffmpeg. It is a heuristic, not face/body detection: on single-subject vertical photos it frames well, on a wide photo with a crowd it can pick the crowd and cut the subject. Real detection is the `#pri 3` todo below.
- Wraps one ffmpeg input per file (`-loop 1 -t <duration> -i <image>`, or `-i <video>`), `scale`+`pad` (or `scale`+`crop` with `--fill`) each to the frame, timestamps reset with `setpts`, joined with the `concat` filter; `libx264` (default High profile), `crf 20`, 30 fps, `yuv420p`, `+faststart`. Plays in browsers, VLC and phone galleries; not tested against the upload limits of WhatsApp or Instagram.
- The output is always silent: the audio of input videos is dropped. Hard cuts, no transitions. An existing output file is never overwritten: the command exits 1. A failed or interrupted run (Ctrl+C) deletes its own partial output and temp files.
- `--selftest` checks the input planning, the ratio → frame size math, the generated ffmpeg arguments, the `--fill` crop size and the EXIF rotation, without rendering a video.

## dev

Git and editor helpers.

### `gitpush`

Runs the commit+push an AI agent prepared for you. The agent writes the commit message to `/tmp/commit/message` and the steps (`cd`, `git add`, `git commit`, `git push`, PR) to `/tmp/commit/script`; you review and run `gitpush`.

```
gitpush
```

- No flags: it just executes `/tmp/commit/script`, so the push runs with your own git/SSH credentials and the agent never pushes on its own.
- The prepared script disarms itself after a successful run, so running `gitpush` twice is harmless (`gitpush: nothing pending`).
- `/tmp/commit/` is one slot for the whole machine: two agents preparing pushes at the same time overwrite each other.

### `gitchat`

Opens a named Claude Code session for the current folder: resumes it if a session with that name already exists here, otherwise creates it. Prints which one it did before opening.

```
gitchat --name email-verein
gitchat --ai claude --name email-verein
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `--name` / `-n` | yes | string | session name |
| `--ai` | no | `claude` | assistant; only `claude` for now (grok has no session names) |
| `--help` / `-h` | no | — | print usage and exit |

- Looks the name up in `~/.claude/projects/<slug of the current path>/*.jsonl`: only the `custom-title` record line written by `claude -n`, never text quoted inside a transcript; the most recently modified matching session wins. Reads Claude Code's on-disk format, so a future change there can break the lookup.
- Names cannot contain `"` or `\`.
- Sessions are per folder: if the name exists only in another folder, it says so and creates a new one here.

### `repo-split-branches`

Checks out every branch of a GitHub repo into its own folder (a git worktree), so several branches can be open side by side without switching.

```
repo-split-branches --repo owner/name                    # every remote branch
repo-split-branches --repo owner/name --branch docs/xyz  # just one
repo-split-branches --repo owner/name --dir ~/work       # somewhere other than the current folder
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `--repo` | yes | `owner/name` | GitHub repo; cloned over SSH into `<dir>/<name>` if not there yet |
| `--branch` | no | branch name | split only this branch (must exist on `origin`) |
| `--dir` | no | folder | where `<name>` and the worktrees live (default: current folder) |

- `<dir>/<name>` stays on its current branch; every other branch gets `<dir>/<name>-<branch>` (`/` becomes `-`, e.g. `docs/xyz` -> `name-docs-xyz`).
- Existing folders and branches already checked out elsewhere are skipped, never overwritten.
- Worktrees share one `.git`: no history is duplicated, but each folder needs its own `npm install`.

### `repo-join-branches`

The reverse of `repo-split-branches`: folds every `<name>-*` worktree folder back into `<name>`.

```
repo-join-branches --repo owner/name
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `--repo` | yes | `owner/name` | same repo given to `repo-split-branches` |
| `--dir` | no | folder | same `--dir` given to `repo-split-branches` (default: current folder) |

- Uncommitted changes in a worktree are saved as a local `wip: uncommitted changes from <folder>` commit on that branch, then the folder is removed. The branch stays in `<name>`: `git switch <branch>` to get back to it.
- Never pushes. Branches with commits not on `origin` are listed at the end.
- Only touches `<name>-*` folders next to `<name>`; worktrees created elsewhere (e.g. by AI agents) are left alone.
- Gitignored files (`.env`, `node_modules`) are not committed and are deleted with the folder: copy any `.env` out first.

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

### `fixvscode`

Fixes VS Code on Linux drawing blank editor windows (stale Electron GPU/shader caches). Desktop only.

```
fixvscode
```

- Snapshots the open windows (`code --status`), quits VS Code gracefully (hot exit keeps unsaved edits), deletes only the GPU/shader cache folders under `~/.config/Code`, then relaunches it; VS Code restores every window.
- Run it from a standalone terminal, not VS Code's integrated one: quitting VS Code would kill the shell running the script.

### `wsname`

Names (or renames) a VS Code workspace and makes that name, instead of the open file, show in the window title and dock. Desktop only, needs `jq`.

```
wsname                                   # the only *.code-workspace in the current folder
wsname foobar                            # same, renamed to foobar.code-workspace
wsname path/to/file.code-workspace foobar
```

- Sets `"window.title": "${rootName}"` in the workspace settings.

## utils

Everything else.

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

## Setup from scratch (to replicate on a VPS)

1. **Node.js + npm** (via nvm, recommended):
   ```
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
   nvm install --lts
   ```

2. **Clone this repo and run the installer**:
   ```
   git clone git@github.com:ara-peaha-ai/ai-cli.git
   cd ai-cli
   ./install.sh
   ```
   See [Install and update](#install-and-update) for what it does.

3. **System tools** the commands shell out to (see [System requirements](#system-requirements) for which command needs what):
   ```
   sudo apt install ffmpeg imagemagick qrencode jq
   ```

4. **Browser (for `chatgpt-image`)** — only this command needs a browser; the download commands use `gallery-dl`.

   **Desktop / machine with a screen** — install any Chromium-family browser:
   ```
   sudo apt install chromium-browser      # or google-chrome-stable, or brave
   ```
   `chatgpt-image` picks the OS default browser if it's Chromium-family, otherwise the first of `chrome` / `chromium` / `brave` it finds. Force one with `AICLI_BROWSER` (env or `.env`):
   ```
   AICLI_BROWSER=chrome        # name: chrome | chromium | brave
   AICLI_BROWSER=/opt/whatever/chrome   # or an absolute path
   ```

   **Headless host / VPS** — no local browser, use [browserless.io](https://www.browserless.io):
   1. Copy `.env.example` to `.env` and set `BROWSERLESS_API_KEY` (from the browserless dashboard). Optional: `BROWSERLESS_URL` to change region, or `BROWSERLESS_WS_ENDPOINT` for a self-hosted/tokenless endpoint. `.env` is git-ignored; the shell environment works too.
   2. On a desktop, run `chatgpt-image --dump-cookies` — log in when the window opens; it writes `bin/ai/chatgpt-cookies.json`.
   3. Copy that file to the host at the same path (or set `CHATGPT_COOKIES_FILE`). Re-run `--dump-cookies` and re-copy whenever the session expires.

   With no `DISPLAY` and `BROWSERLESS_API_KEY` set, the browserless path is used automatically. Check any machine with `ai-cli doctor`.

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
   - `chatgpt-image` with a **local browser**: a persistent profile at `bin/ai/chrome-profile-chatgpt/` (created on first run); if not logged in, a **visible** window opens for a hand login (up to 5 min), then it continues. With **browserless / a headless host**: it can't keep a profile over a remote connection, so it loads `bin/ai/chatgpt-cookies.json` — see step 4. Alternative to browserless on a VPS: do the first login on a desktop and copy the whole `bin/ai/chrome-profile-chatgpt/` folder over, then a locally-installed headless Chromium runs from there with no display.
   - `instagram-download*`, `tiktok-download*`, and `x-download*` use `gallery-dl --cookies-from-browser chrome`, which reads cookies from the system's *default* Chrome profile (the one you use daily, already logged into Instagram/TikTok/X). Without `secretstorage` installed (step 5), cookie decryption silently fails for most cookies and requests get redirected to the login page even though you're actually logged in in Chrome — if you see login-redirect errors, check that `secretstorage` is injected into the `gallery-dl` pipx venv. **`--cookies-from-browser` also doesn't work out of the box on a display-less VPS with no locally logged-in Chrome.** Practical workaround: export cookies from your local Chrome into a `cookies.txt` file (e.g. with the "Get cookies.txt LOCALLY" extension), copy it to the VPS, and swap `--cookies-from-browser chrome` for `--cookies /path/to/cookies.txt` in the scripts — not implemented yet, do this if/when the VPS move actually happens.

## Install and update

```
./install.sh               # everything below
./install.sh --with-face   # also build the enhance-face stack (~2 GB)
./install.sh --help
```

`install.sh` is safe to re-run. It:

1. runs `npm install` and `npm link`, which registers every entry of `bin` in `package.json` as a global command (bash and Python scripts included, not only Node);
2. removes global command links left dangling by renamed or removed commands;
3. sets `git config core.hooksPath .githooks`, so after every `git pull` that changes `package.json`, `package-lock.json` or `install.sh`, the `post-merge` hook re-runs `./install.sh` by itself;
4. adds one line to `~/.bashrc` that sources [`shell/aliases.sh`](#shell-aliases) (only once).

Edits to an existing script need nothing: the global commands are symlinks into this repo, so the change is live right away. A **new** command needs an entry in `bin` in `package.json`; the hook (or `./install.sh`) picks it up.

The commands are linked into the global bin folder of the current Node version. After `nvm install` of a new Node version, run `./install.sh` again.

### Server install (planned)

The same `install.sh` is meant to become the one entry point for a VPS, in the style of the BTCPay Server installer: a cloud-init `user-data` script pasted in the provider's form clones the repo and runs `./install.sh` with flags that pick which parts to set up (the way BTCPay uses `BTCPAYGEN_*` fragments and pruning options). Today the only optional part is `--with-face`; new parts get added as new `--with-*` flags, so existing installs keep working unchanged.

### Shell aliases

`shell/aliases.sh`, sourced from `~/.bashrc`:

| Alias / function | What it does |
|---|---|
| `t <name>` | Sets a fixed title on the current terminal tab |
| `aic <name>` | `t` + `gitchat --name <name>`: resumes the Claude Code session with that name, or creates it |
| `aicm <name>` | inside a repo: `git switch main`, `git pull --ff-only`, then `aic <name>`; stops if the tree is dirty or the pull is not a fast-forward |
| `aig <name>` | `t` + starts Grok |
| `rgcode <pattern>` | `rg` skipping `node_modules`, `.git`, `dist`, `build`, `venv`, `__pycache__`, `.next` |
| `killproton` | Force-kills ProtonVPN |
| `killfolder` / `killnautilus` | Force-kills the file manager (Nautilus) |

### System requirements

All commands support `--help` / `-h`. `get-first-frame`, `get-last-frame`, `blur-video`, `text-overlay`, `watermark-video`, `slideshow`, and `webp-to-jpg`/`image-to-jpg` (for `.webp` input) additionally require `ffmpeg` on `PATH` (`sudo apt install ffmpeg`). `upscale`, `heic-to-jpg`, and `image-to-jpg` (for `.heic`/`.heif`/`.avif` input) require `convert` from ImageMagick on `PATH` (`sudo apt install imagemagick`) — built with HEIC support (check with `convert -list format | grep -i heic`; if missing, install `libheif-dev` before ImageMagick, or use a distro package that bundles it). `chatgpt-image` and `create-virtual-ambassador` require a Chromium-family browser on the machine **or** a browserless.io endpoint (`BROWSERLESS_API_KEY`) — see setup step 4. `watermark-image`, `watermark-video` and `slideshow` require the `sharp` npm dependency (installed via `npm install`, no system package needed). `redact-faces` requires Sightengine API credentials (flags or env vars, see above). `share-qr` requires `qrencode` on `PATH` (`sudo apt install qrencode`). `search-string` requires `find` and `grep` on `PATH` (present by default on Linux). The `instagram-*`, `tiktok-*` and `x-*` commands need `gallery-dl` (setup step 5). `repo-split-branches` / `repo-join-branches` need `git` with SSH access to GitHub. `enhance-face` needs Python 3 with `venv`, `curl` and ~2 GB of disk (`./install.sh --with-face`). `wsname` needs `jq`.

## Scraper status

Checked on 2026-10-04 with `gallery-dl` 1.32.13-dev.

| Platform | Status | Notes |
|---|---|---|
| TikTok | works | Single video download and profile listing work with Chrome cookies. `yt-dlp` does **not** work for TikTok profiles without impersonation (`pipx inject yt-dlp curl-cffi`), which is why these commands use `gallery-dl`. Profile listing pages through every post before downloading, so large profiles take a while to start. |
| Instagram | not re-checked | Needs `secretstorage` injected into the `gallery-dl` venv (setup step 5), or the requests get redirected to the login page. |
| X | not re-checked | |

## Repo structure

```
ai-cli/
├── install.sh                      # install / update everything (see "Install and update")
├── .githooks/post-merge            # re-runs install.sh after a pull that changes the command list
├── shell/aliases.sh                # shell aliases, sourced from ~/.bashrc
├── .env.example                    # browser / browserless / API env vars (copy to .env)
├── bin/
│   ├── ai-cli.js                   # command: ai-cli (lists all commands; `ai-cli doctor`)
│   ├── lib/                        # shared code: browser.js, chatgpt-session.js, sort-media.js
│   ├── ai/                         # chatgpt-image, create-virtual-ambassador, enhance-face, redact-faces
│   │   ├── chrome-profile-chatgpt/ # persistent browser profile (ChatGPT login) — git-ignored
│   │   └── chatgpt-cookies.json    # ChatGPT cookies for the browserless path — git-ignored
│   ├── social/                     # instagram-*, tiktok-*, x-* downloaders
│   ├── media/                      # image conversion, upscale, watermarks, video frames/blur/overlay, slideshow
│   ├── dev/                        # gitchat, gitpush, repo-split-branches, repo-join-branches, search-string, fixvscode, wsname
│   └── utils/                      # share-qr
├── package.json                    # `bin`: command name -> script, read by npm link
└── README.md
```

Each command is one file, named after the command (`.js`, `.sh` or `.py`). To add one: drop the file in the right area folder, make it executable, add it to `bin` in `package.json` and to the list in `bin/ai-cli.js`.

## Todo

##todo @giovanni

- this repo becomes the ai-server (to distinguish from the pay-server) and the existing tools a small part of it. oppure no, rimane quello che 
- add languagetool selfhosted o meglio https://github.com/rayliuca/grammared-language con intregato modello ai leggero. 

##todo @ai

- `slideshow` #pri 3: `--fill` currently crops with `sharp`'s `attention` heuristic. Tested 2026-10-08 on 8 single-model photos: good on vertical shots, but it cut half a face on a tight close-up and, on a wide photo with a crowd, framed the crowd and left the subject out. If that keeps happening, replace the heuristic with real face + body boxes on CPU and crop centered on their union (locally, no paid API, no generative model that redraws the image like ChatGPT/Grok). Face detection already exists in the `enhance-face` venv (GFPGAN's `facexlib`/RetinaFace, `./install.sh --with-face`); bodies need something else, e.g. OpenCV DNN or MediaPipe Pose (a new `--with-*` install part). Not usable as-is: `upscale` (resize only), `redact-faces` (faces through the paid Sightengine API).
- From the Grok review of PR #6, not fixed there because they need a live ChatGPT / platform run to verify: `create-virtual-ambassador` waits only for an 8s idle gap (may keep 1 of 3 images), names variants by network order, matches a stale refusal from the reopened chat, and uploads faces to quantilence.com without asking; the batch downloaders look for the avatar only at the top of the output folder and flatten subfolders by basename (same name in two highlights overwrites); `enhance-face-setup.sh` has unpinned pip packages and no weight checksums.
