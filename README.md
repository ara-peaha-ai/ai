# ai-cli toolbox

Terminal commands for AI/media workflows: drives a local Chromium-family browser or a remote browserless.io instance (via puppeteer-core, for ChatGPT) or `gallery-dl` (for Instagram/TikTok/X) using already-authenticated sessions instead of reinventing login/scraping, plus a set of `ffmpeg`/ImageMagick-based image and video utilities.

## Commands

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
- **Auth (local browser)**: a dedicated persistent profile at `bin/chrome-profile-chatgpt/`. Tries headless first; if not logged in it opens a **visible** window and waits up to 5 minutes for a hand login, then continues.
- **Auth (browserless / headless)**: no persistent profile is possible over a remote connection, so it loads `bin/chatgpt-cookies.json` (generate it on a desktop with `chatgpt-image --dump-cookies`, copy it over, or point `CHATGPT_COOKIES_FILE` elsewhere). Stale/missing cookies fail with an explicit message.
- Output: saved next to the input file as `<input-name>-mod.<ext>` (e.g. `photo-mod.png`).

### `create-virtual-ambassador`
Uploads every image in a folder to ChatGPT in one message with a fixed prompt asking for a derived (not identical) avatar, and saves the result — built to turn a `select-best-photos` shortlist into one usable avatar image.

```
create-virtual-ambassador                    # uploads everything in ./references
create-virtual-ambassador ./some-photos
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `[images-dir]` | no | folder of images | positional argument, first non-flag arg — defaults to `./references` |
| `--dump-cookies` | no | — | local login only: save `chatgpt-cookies.json` for use on a headless host, then exit |
| `--help` / `-h` | no | — | print usage and exit |

- Shares its ChatGPT login/session (`bin/chrome-profile-chatgpt/`, `bin/chatgpt-cookies.json`) with `chatgpt-image` — see that section above for the browser/auth details, identical here.
- Prompt sent (fixed, not configurable): *"Create a model derived from the input images attached to this prompt. Preserve the distinctive features of the original model, but make it resemble the original without being identical. Return the output with a 1:1 layout and a transparent background."*
- Output: `avatar/genesis.<ext>` under the **current directory** (not `[images-dir]`) — extension follows whatever ChatGPT returns (typically `.png` for a transparent background).
- If ChatGPT refuses on content-guideline grounds (nudity/sexuality/erotic content), this has no way to tell which of the uploaded images triggered it — it prints the refusal and the list of uploaded files so you can remove the suspect one by hand and try again. No automatic retry.

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
- After each run, images are moved into `instagram/img/` and reels/videos into `instagram/vid/` (flattening any per-highlight subfolder gallery-dl created), regardless of exit status — so a partial download still gets sorted.
- Also downloads the profile's current avatar to `instagram/profile.<ext>` — used by `select-best-photos` to identify which recurring face in the feed is the account owner.

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
- After each run, images are moved into `tiktok/img/` and videos into `tiktok/vid/`, regardless of exit status — so a partial download still gets sorted.
- Also downloads the profile's current avatar to `tiktok/profile.<ext>` — used by `select-best-photos` to identify which recurring face in the feed is the account owner.

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
- Output: saves into an `x/` subfolder in the current directory (shared across all profiles, not one folder per profile), files named the same way as `x-download`. Keeps an `x/.downloaded.sqlite3` archive so reruns skip posts already downloaded.
- After each run, images are moved into `x/img/` and videos into `x/vid/`, regardless of exit status — so a partial download still gets sorted.
- Also downloads the profile's current avatar to `x/profile.<ext>` — used by `select-best-photos` to identify which recurring face in the feed is the account owner.

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
- Output: `<name>.jpg` next to the input, in the same folder. By default the original is deleted after a successful conversion — pass `--keep` to preserve it.

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
- Output: `<name>.jpg` next to the input, in the same folder. By default the original is deleted after a successful conversion — pass `--keep` to preserve it.
- Ported from a `webptojpg()` bash function that used to live in `~/.bashrc` (removed from there — this is now the canonical version).

### `image-to-jpg`
One command for any supported source format, dispatched by file extension — same behaviour as `webp-to-jpg` / `heic-to-jpg`, just picked automatically. Currently supports `.webp`, `.heic`, `.heif`; a folder input can mix formats freely.

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
| `--quality` | no | 1-100 | JPEG output quality — ImageMagick-based formats only (`.heic`/`.heif`); ignored for `.webp` (default: `92`) |
| `--keep` | no | — | keep the original file(s) instead of deleting them |
| `--help` / `-h` | no | — | print usage and exit |

- Extensions are looked up in a `CONVERTERS` map at the top of `bin/image-to-jpg.js` — adding a new source format later means adding one entry there, nothing else changes.
- Output: `<name>.jpg` next to the input, in the same folder. By default the original is deleted after a successful conversion — pass `--keep` to preserve it.

### `select-best-photos`
Picks the best, most representative solo photos of one person out of a downloaded feed — built for curating profile-photo candidates. Run it from the folder that holds the platform subfolders (`instagram/`, `tiktok/`, `x/` — whichever `*-download-batch` produced — plus `web/` for anything curated by hand in the same `img/`+`vid/`+`profile.*` shape) that exist; it pulls from all of them at once. Pointed at a single account root instead (one folder with `img/`, `vid/`, `profile.*` directly in it, not wrapped in a platform subfolder), it works on just that one.

```
select-best-photos                                       # ./instagram, ./tiktok, ./x, ./web — whichever exist
select-best-photos --count 10 ./fatima-olana
select-best-photos --profile-photo ./me.jpg ./fatima-olana
cd instagram && select-best-photos                       # single-platform mode, profile.jpg here picked up automatically
```

| Flag | Required | Value | Description |
|---|---|---|---|
| `[folder]` | no | root folder | positional argument, first non-flag arg — defaults to `.` |
| `--count` | no | integer | how many photos to select (default: `20`) |
| `--profile-photo` | no | image file path | reference photo to match the subject against — auto-detects every `profile.*` found if omitted |
| `--full-body-min` | no | integer | try to reserve this many full-body shots among the selection, if any exist (default: `3`) |
| `--help` / `-h` | no | — | print usage and exit |

Pipeline, in order:
1. **Roots**: if `[folder]` contains an `instagram/`, `tiktok/`, `x/`, and/or `web/` subfolder, all of those become roots (mixed together into one pool); otherwise `[folder]` itself is the one root — img/ for images, vid/ for video first-frames, falling back to scanning `[folder]` directly if it has no `img/` subfolder (works as a plain "folder of photos" tool too).
2. **Candidates**: every image in each root's `img/`, plus a first frame extracted straight into memory (never written to disk) from every video in each root's `vid/`.
3. **One whole person, not a crop-off close-up of just a face fragment**: `@tensorflow-models/coco-ssd` counts people in frame — anything with 0 or more than 1 person is dropped (so group shots are out).
4. **Face detection + 128-d descriptor**: `@vladmandic/face-api` (`ssdMobilenetv1`, not the faster `tinyFaceDetector` — the tiny one missed faces in tight/tilted-head crops in testing). No face found → dropped.
5. **Whose photo is it**: matched against `--profile-photo`, or every auto-detected `profile.*` found (one per platform when pulling from several — dropped there automatically by `*-download-batch` when it runs, see above), by face-descriptor distance against any of them. With none available, falls back to single-linkage clustering across all candidates and keeps the largest cluster (majority-vote guess at who the recurring subject is) — noisier, so a profile photo is the better path when you have one.
6. **Quality scoring**: sharpness (Laplacian variance), resolution, exposure/contrast (`sharp().stats()`), and how prominent the face is in frame — combined into one score per item, all computed locally, no model needed for this part.
7. **Shot type** (`@tensorflow-models/pose-detection`, MoveNet): classified as headshot / half-body / full-body from visible keypoints — used only to try to reserve `--full-body-min` slots for full-body shots when available, not as a filter; close-ups and half-body shots are fine on their own.
8. **Final N**: ranked by quality, then filled via a diversity-aware pass (`@tensorflow-models/mobilenet` embeddings + maximal-marginal-relevance) so the selection doesn't end up as 20 near-duplicate shots from the same burst — mixing candidates from every platform in the same pool.

- Runs entirely on CPU via `@tensorflow/tfjs-node` — confirmed working on Node 22 with no GPU. `@vladmandic/face-api` ships its model weights inside the npm package (fully offline); `coco-ssd` and `pose-detection` download their weights from `storage.googleapis.com`, `mobilenet` from `tfhub.dev`, on first run (a few tens of MB total) — pre-warm this with a throwaway run before going offline on a VPS. A VPN that blocks or reroutes either host will fail this step with a plain `fetch failed` — disconnect it and retry if that happens.
- Video candidates are just a single extracted frame (typically the very first), not the best moment in the clip — a reel's best shot mid-video won't be picked up this way.
- This is heuristic, not a validated classifier — expect occasional misses (person-detection can miss extreme crops, the identity match can be fooled by very similar-looking faces) and treat the output as a shortlist to skim, not a final answer.
- Output: `<folder>/references/` — images are copied from `img/`, video frames are saved as `<video-name>-first-frame.jpg`, both prefixed with the platform name (`instagram-`, `tiktok-`, `x-`, `web-`) when pulling from more than one, to avoid same-name collisions. Only items that make the final selection are ever written; everything else stays in memory for the duration of the run and is discarded. Originals in `img/`/`vid/` are never touched or moved.

### `ai-cli`
Lists all commands in this toolbox with a short description.

```
ai-cli --help
ai-cli doctor    # which browser chatgpt-image would use here (local family / browserless / none)
```

All twenty-three commands support `--help` / `-h`. `get-first-frame`, `get-last-frame`, `blur-video`, `text-overlay`, `watermark-video`, `webp-to-jpg`, `image-to-jpg` (for `.webp` input), and `select-best-photos` (to extract video first-frames) additionally require `ffmpeg` on `PATH` (`sudo apt install ffmpeg`). `upscale`, `heic-to-jpg`, and `image-to-jpg` (for `.heic`/`.heif` input) require `convert` from ImageMagick on `PATH` (`sudo apt install imagemagick`) — built with HEIC support (check with `convert -list format | grep -i heic`; if missing, install `libheif-dev` before ImageMagick, or use a distro package that bundles it). `chatgpt-image` and `create-virtual-ambassador` require a Chromium-family browser on the machine **or** a browserless.io endpoint (`BROWSERLESS_API_KEY`) — see setup step 4. `watermark-image`, `watermark-video`, and `select-best-photos` require the `sharp` npm dependency (installed via `npm install`, no system package needed). `select-best-photos` additionally pulls in `@tensorflow/tfjs-node` + several `@tensorflow-models/*` packages and `@vladmandic/face-api` (also via `npm install`, CPU-only, no GPU/system package needed). `redact-faces` requires Sightengine API credentials (flags or env vars, see above). `share-qr` requires `qrencode` on `PATH` (`sudo apt install qrencode`). `search-string` requires `find` and `grep` on `PATH` (present by default on Linux).

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
   After `npm link`, all twenty-three commands listed above are available from any directory (as long as the shell's `PATH` includes the npm global bin dir — true by default).

   **Whenever a new command is added to `bin` in `package.json`, re-run `npm link`** — it's not automatic, and an existing link doesn't pick up new entries on its own. Until then the new command resolves as `command not found` even though the file is in the repo.

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
   2. On a desktop, run `chatgpt-image --dump-cookies` — log in when the window opens; it writes `bin/chatgpt-cookies.json`.
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
   - `chatgpt-image` with a **local browser**: a persistent profile at `bin/chrome-profile-chatgpt/` (created on first run); if not logged in, a **visible** window opens for a hand login (up to 5 min), then it continues. With **browserless / a headless host**: it can't keep a profile over a remote connection, so it loads `bin/chatgpt-cookies.json` — see step 4. Alternative to browserless on a VPS: do the first login on a desktop and copy the whole `bin/chrome-profile-chatgpt/` folder over, then a locally-installed headless Chromium runs from there with no display.
   - `instagram-download*`, `tiktok-download*`, and `x-download*` use `gallery-dl --cookies-from-browser chrome`, which reads cookies from the system's *default* Chrome profile (the one you use daily, already logged into Instagram/TikTok/X). Without `secretstorage` installed (step 5), cookie decryption silently fails for most cookies and requests get redirected to the login page even though you're actually logged in in Chrome — if you see login-redirect errors, check that `secretstorage` is injected into the `gallery-dl` pipx venv. **`--cookies-from-browser` also doesn't work out of the box on a display-less VPS with no locally logged-in Chrome.** Practical workaround: export cookies from your local Chrome into a `cookies.txt` file (e.g. with the "Get cookies.txt LOCALLY" extension), copy it to the VPS, and swap `--cookies-from-browser chrome` for `--cookies /path/to/cookies.txt` in the scripts — not implemented yet, do this if/when the VPS move actually happens.

## Repo structure

```
ai-cli/
├── .env.example                   # browser / browserless env vars (copy to .env)
├── bin/
│   ├── lib/
│   │   ├── browser.js             # local-vs-browserless resolution, shared
│   │   ├── sort-media.js          # moves files into img/ + vid/, shared by the batch downloaders
│   │   └── chatgpt-session.js     # ChatGPT login/cookies/page automation, shared by chatgpt-image + create-virtual-ambassador
│   ├── chatgpt-image.js            # command: chatgpt-image
│   ├── create-virtual-ambassador.js # command: create-virtual-ambassador
│   ├── instagram-download.js       # command: instagram-download
│   ├── instagram-download-batch.js # command: instagram-download-batch
│   ├── tiktok-download.js          # command: tiktok-download
│   ├── tiktok-download-batch.js    # command: tiktok-download-batch
│   ├── x-download.js                # command: x-download
│   ├── x-download-batch.js          # command: x-download-batch
│   ├── get-first-frame.js          # command: get-first-frame
│   ├── get-last-frame.js           # command: get-last-frame
│   ├── blur-video.js                # command: blur-video
│   ├── text-overlay.js              # command: text-overlay
│   ├── upscale.js                   # command: upscale
│   ├── heic-to-jpg.js                # command: heic-to-jpg
│   ├── webp-to-jpg.js                # command: webp-to-jpg
│   ├── image-to-jpg.js               # command: image-to-jpg
│   ├── share-qr.js                  # command: share-qr
│   ├── search-string.js             # command: search-string
│   ├── watermark-image.js           # command: watermark-image
│   ├── watermark-video.js           # command: watermark-video
│   ├── redact-faces.js              # command: redact-faces
│   ├── select-best-photos.js        # command: select-best-photos
│   ├── ai-cli.js                    # command: ai-cli (lists all commands; `ai-cli doctor`)
│   ├── chatgpt-cookies.json        # ChatGPT cookies for the browserless path — git-ignored
│   └── chrome-profile-chatgpt/     # persistent browser profile (ChatGPT login) — git-ignored
├── package.json
└── README.md
```

## Todo

##todo @giovanni

- this repo becomes the ai-server (to distinguish from the pay-server) and the existing tools a small part of it. oppure no, rimane quello che 
- add languagetool selfhosted o meglio https://github.com/rayliuca/grammared-language con intregato modello ai leggero. 
