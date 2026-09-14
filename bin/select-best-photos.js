#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { IMAGE_EXT, VIDEO_EXT } = require('./lib/sort-media');

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--count', '--profile-photo', '--full-body-min']);

const getFlag = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const folder = args.find(
  (a, i) => !a.startsWith('-') && !(i > 0 && VALUE_FLAGS.has(args[i - 1]))
) || '.';
const count = Number(getFlag('--count', '20'));
const fullBodyMin = Number(getFlag('--full-body-min', '3'));
const profilePhotoFlag = getFlag('--profile-photo', null);

const cosineDistance = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
};

// simple union-find single-linkage clustering, threshold = same-person cutoff
// typical for face-api's 128-d descriptors.
const largestFaceCluster = (descriptors, threshold = 0.6) => {
  const parent = descriptors.map((_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (let i = 0; i < descriptors.length; i++) {
    for (let j = i + 1; j < descriptors.length; j++) {
      if (euclideanDistance(descriptors[i], descriptors[j]) < threshold) union(i, j);
    }
  }
  const sizes = new Map();
  for (let i = 0; i < descriptors.length; i++) sizes.set(find(i), (sizes.get(find(i)) || 0) + 1);
  const [best] = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  return descriptors.map((_, i) => find(i) === best);
};

const euclideanDistance = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
};

// Laplacian-variance sharpness on a downscaled grayscale buffer — capped
// resize keeps this cheap regardless of source resolution. `source` is
// anything sharp() accepts: a file path or a Buffer.
const sharpnessScore = async (source) => {
  const { data, info } = await sharp(source)
    .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap = data[i - width] + data[i + width] + data[i - 1] + data[i + 1] - 4 * data[i];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  return Math.min(1, variance / 500); // ponytail: empirical cap, not calibrated against a labelled set
};

// First video frame, piped straight to a Buffer — never touches disk.
const extractFirstFrame = (videoPath) => {
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-i', videoPath, '-frames:v', '1', '-f', 'image2', '-vcodec', 'mjpeg', 'pipe:1'],
    { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 50 * 1024 * 1024 }
  );
  if (r.error || r.status !== 0 || !r.stdout || r.stdout.length === 0) return null;
  return r.stdout;
};

const selectBestPhotos = async ({ folder, count, fullBodyMin, profilePhotoFlag, log = () => {} }) => {
  const tf = require('@tensorflow/tfjs-node');
  const cocoSsd = require('@tensorflow-models/coco-ssd');
  const poseDetection = require('@tensorflow-models/pose-detection');
  const mobilenet = require('@tensorflow-models/mobilenet');
  const faceapi = require('@vladmandic/face-api');

  const modelDir = path.join(path.dirname(require.resolve('@vladmandic/face-api/package.json')), 'model');
  // ssdMobilenetv1, not the faster tinyFaceDetector — empirically, tiny missed
  // faces in tight/tilted-head crops (the exact shape a lot of profile photos
  // and headshots are); ssdMobilenetv1 caught them at ~280ms/image on CPU.
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelDir);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(modelDir);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(modelDir);

  log('loading models...');
  const [personModel, poseModel, embeddingModel] = await Promise.all([
    cocoSsd.load({ base: 'lite_mobilenet_v2' }),
    poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
    }),
    mobilenet.load({ version: 2, alpha: 1.0 }),
  ]);

  const toTensor = async (source) => {
    const { data, info } = await sharp(source).removeAlpha().toColorspace('srgb').raw().toBuffer({ resolveWithObject: true });
    return tf.tensor3d(data, [info.height, info.width, info.channels], 'int32');
  };

  const faceDescriptorOf = async (tensor) => {
    const result = await faceapi
      .detectSingleFace(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    return result || null;
  };

  // ---- which roots to scan ----
  // if "folder" holds any of instagram/tiktok/x subfolders (as produced by
  // *-download-batch), pull from all of those at once; otherwise treat
  // "folder" itself as a single account root (or a flat folder of photos).
  const PLATFORMS = ['instagram', 'tiktok', 'x', 'web'];
  const platformRoots = PLATFORMS
    .map((p) => path.join(folder, p))
    .filter((p) => fs.existsSync(p) && fs.statSync(p).isDirectory());
  const multiPlatform = platformRoots.length > 0;
  const roots = multiPlatform ? platformRoots : [folder];
  if (multiPlatform) log(`platforms found: ${platformRoots.map((r) => path.basename(r)).join(', ')}`);

  // ---- reference face(s) (profile photo) ----
  // each *-download-batch drops profile.<ext> in its own root; with multiple
  // platforms we collect every one we can find a face in and match against
  // any of them (more angles/lighting = fewer missed matches).
  let referenceDescriptors = [];
  const profileNames = ['profile.jpg', 'profile.jpeg', 'profile.png', 'profile.webp'];
  const refPaths = profilePhotoFlag
    ? [profilePhotoFlag]
    : roots.flatMap((root) => profileNames.map((n) => path.join(root, n))).filter((p) => fs.existsSync(p));
  for (const refPath of refPaths) {
    const t = await toTensor(refPath);
    const face = await faceDescriptorOf(t);
    t.dispose();
    if (face) {
      referenceDescriptors.push(face.descriptor);
      log(`reference face: ${refPath}`);
    } else {
      log(`⚠️  no face found in ${refPath}`);
    }
  }
  if (referenceDescriptors.length === 0) {
    log('no profile photo given/found — will guess the owner from the majority face cluster');
  }

  // ---- gather candidates: images from img/, video first-frames from vid/ ----
  // falls back to scanning a root directly when it has no img/ subfolder, so
  // this still works as a plain "folder of photos" tool (only in single-root
  // mode — each platform root is always expected to have img/ + vid/).
  const gatherItems = (root) => {
    const imgDir = path.join(root, 'img');
    const vidDir = path.join(root, 'vid');
    const useImgDir = fs.existsSync(imgDir) && fs.statSync(imgDir).isDirectory();
    const useVidDir = fs.existsSync(vidDir) && fs.statSync(vidDir).isDirectory();
    const platform = multiPlatform ? path.basename(root) : null;

    const imageItems = fs.readdirSync(useImgDir ? imgDir : root, { withFileTypes: true })
      .filter((e) => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase()))
      .filter((e) => !/^profile\./.test(e.name))
      .map((e) => ({ file: path.join(useImgDir ? imgDir : root, e.name), isVideo: false, platform }));

    const videoItems = useVidDir
      ? fs.readdirSync(vidDir, { withFileTypes: true })
        .filter((e) => e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase()))
        .map((e) => ({ file: path.join(vidDir, e.name), isVideo: true, platform }))
      : [];

    return [...imageItems, ...videoItems];
  };

  const items = roots.flatMap(gatherItems);
  const videoCount = items.filter((i) => i.isVideo).length;

  log(`analyzing ${items.length} item(s) (${items.length - videoCount} image(s), ${videoCount} video(s))...`);
  const candidates = [];
  let rejectedPersonCount = 0, rejectedNoFace = 0, rejectedUnreadable = 0, processed = 0;
  const logProgress = () => {
    processed++;
    if (processed % 10 === 0 || processed === items.length) log(`  ...${processed}/${items.length}`);
  };

  for (const item of items) {
    const source = item.isVideo ? extractFirstFrame(item.file) : item.file;
    if (!source) {
      rejectedUnreadable++;
      logProgress();
      continue;
    }

    let tensor;
    try {
      tensor = await toTensor(source);
    } catch {
      rejectedUnreadable++;
      logProgress();
      continue;
    }

    try {
      const persons = (await personModel.detect(tensor)).filter((p) => p.class === 'person' && p.score > 0.5);
      if (persons.length !== 1) {
        rejectedPersonCount++;
        continue;
      }

      const face = await faceDescriptorOf(tensor);
      if (!face) {
        rejectedNoFace++;
        continue;
      }

      const poses = await poseModel.estimatePoses(tensor);
      const kp = Object.fromEntries((poses[0]?.keypoints || []).map((k) => [k.name, k]));
      const has = (name) => kp[name] && kp[name].score > 0.3;
      const shotType = has('left_ankle') || has('right_ankle')
        ? 'full-body'
        : (has('left_hip') || has('right_hip') || has('left_knee') || has('right_knee'))
          ? 'half-body'
          : 'headshot';

      const embeddingTensor = embeddingModel.infer(tensor, true);
      const embedding = Array.from(embeddingTensor.dataSync());
      embeddingTensor.dispose();

      const meta = await sharp(source).metadata();
      const stats = await sharp(source).stats();
      const avgMean = stats.channels.reduce((s, c) => s + c.mean, 0) / stats.channels.length;
      const avgStdev = stats.channels.reduce((s, c) => s + c.stdev, 0) / stats.channels.length;
      const exposureScore = 1 - Math.abs(avgMean - 128) / 128;
      const contrastScore = Math.min(1, avgStdev / 60);
      const resolutionScore = Math.min(1, (meta.width * meta.height) / (1600 * 1600));
      const sharpness = await sharpnessScore(source);
      const faceArea = (face.detection.box.width * face.detection.box.height) / (meta.width * meta.height);
      const faceScore = Math.min(1, faceArea / 0.05);

      const quality = 0.30 * sharpness + 0.15 * resolutionScore + 0.15 * exposureScore
        + 0.15 * contrastScore + 0.25 * faceScore;

      // video frames are kept as an in-memory buffer, only written to disk if
      // selected — everything that doesn't make the cut never touches disk.
      candidates.push({
        file: item.file,
        isVideo: item.isVideo,
        platform: item.platform,
        buffer: item.isVideo ? source : null,
        shotType,
        quality,
        embedding,
        faceDescriptor: face.descriptor,
      });
    } finally {
      tensor.dispose();
      logProgress();
    }
  }

  log(`candidates: ${candidates.length} (rejected: ${rejectedPersonCount} not-single-person, ${rejectedNoFace} no-face-detected, ${rejectedUnreadable} unreadable)`);

  // ---- identity filtering ----
  let identityFiltered = candidates;
  if (referenceDescriptors.length > 0) {
    identityFiltered = candidates.filter((c) => referenceDescriptors.some((ref) => euclideanDistance(c.faceDescriptor, ref) < 0.6));
    log(`matching profile photo: ${identityFiltered.length}/${candidates.length}`);
  } else if (candidates.length > 1) {
    const mask = largestFaceCluster(candidates.map((c) => c.faceDescriptor));
    identityFiltered = candidates.filter((_, i) => mask[i]);
    log(`majority-face cluster: ${identityFiltered.length}/${candidates.length}`);
  }

  // ---- selection: N images, quality-first, some full-body reserved, MMR for diversity ----
  const ranked = [...identityFiltered].sort((a, b) => b.quality - a.quality);
  const selected = [];
  const reserveCount = Math.min(fullBodyMin, count);
  for (const c of ranked.filter((c) => c.shotType === 'full-body')) {
    if (selected.length >= reserveCount) break;
    selected.push(c);
  }
  let pool = ranked.filter((c) => !selected.includes(c));
  while (selected.length < count && pool.length > 0) {
    let bestIdx = 0, bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      const minDist = selected.length === 0 ? 1 : Math.min(...selected.map((s) => cosineDistance(c.embedding, s.embedding)));
      const mmr = 0.7 * c.quality + 0.3 * minDist;
      if (mmr > bestScore) { bestScore = mmr; bestIdx = i; }
    }
    selected.push(pool[bestIdx]);
    pool.splice(bestIdx, 1);
  }

  // ---- output: only the selected items ever get written to disk ----
  // platform-prefixed when pulling from multiple platforms, so e.g. an
  // instagram and a tiktok file that happen to share a basename don't collide.
  const outDir = path.join(folder, 'references');
  fs.mkdirSync(outDir, { recursive: true });
  for (const c of selected) {
    const prefix = c.platform ? `${c.platform}-` : '';
    if (c.isVideo) {
      fs.writeFileSync(path.join(outDir, `${prefix}${path.parse(c.file).name}-first-frame.jpg`), c.buffer);
    } else {
      fs.copyFileSync(c.file, path.join(outDir, `${prefix}${path.basename(c.file)}`));
    }
  }

  return { candidates: candidates.length, identityFiltered: identityFiltered.length, selected, outDir };
};

if (args.includes('--selftest')) {
  const assert = require('assert');
  assert.strictEqual(Math.round(euclideanDistance([0, 0], [3, 4])), 5);
  assert.ok(cosineDistance([1, 0], [1, 0]) < 1e-9);
  assert.ok(cosineDistance([1, 0], [0, 1]) > 0.99);
  const mask = largestFaceCluster([[0, 0], [0, 0.1], [10, 10]], 0.6);
  assert.deepStrictEqual(mask, [true, true, false]);
  console.log('selftest ok (distance math + clustering)');
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h') || !(count > 0) || !(fullBodyMin >= 0)) {
  console.error(
    [
      'Usage: select-best-photos [--count N] [--profile-photo <path>] [--full-body-min N] [folder]',
      '',
      '  [folder]             root folder — defaults to "."',
      '                       if it contains an instagram/, tiktok/, x/, and/or web/ subfolder',
      '                       (the first three from *-download-batch, "web" for anything you',
      '                       curate by hand in the same img/+vid/+profile.* shape), pulls',
      '                       from all of them at once; otherwise treats [folder] itself as',
      '                       one account root — img/ for images, vid/ for video first-frames,',
      '                       falling back to scanning [folder] directly if it has no img/ subfolder',
      '  --count <N>          how many photos to select                        [20]',
      '  --profile-photo <p>  reference photo to match the subject against —',
      '                       auto-detects every "profile.*" found (one per platform',
      '                       when pulling from several) if omitted',
      '                       (as saved by instagram-download-batch / tiktok-download-batch / x-download-batch)',
      '  --full-body-min <N>  try to reserve this many full-body shots, if any   [3]',
      '  --help / -h          print usage and exit',
      '',
      'Keeps only items with exactly one whole person recognisably matching the',
      'reference face (or, with no reference, the person appearing in most items),',
      'ranks the rest by sharpness/exposure/contrast/face prominence, and picks',
      '<count> of them balancing quality with visual variety (MMR over general-',
      'purpose image embeddings) — while trying to include a few full-body shots.',
      '',
      'Video frames are extracted straight to memory (never written to disk) and',
      'only saved if they end up selected, as "<video-name>-first-frame.jpg".',
      '',
      'Runs entirely on CPU via @tensorflow/tfjs-node — no GPU, no external API.',
      'First run downloads the coco-ssd/pose-detection/mobilenet model weights',
      '(a few tens of MB); @vladmandic/face-api ships its weights in the npm',
      'package itself, so that part works fully offline.',
      '',
      'Output: copies/saves the selection into "<folder>/references/" (originals untouched).',
    ].join('\n')
  );
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

selectBestPhotos({ folder, count, fullBodyMin, profilePhotoFlag, log: console.log })
  .then(({ candidates, identityFiltered, selected, outDir }) => {
    console.log(`✅ selected ${selected.length}/${identityFiltered} (of ${candidates} single-person candidates) -> ${outDir}`);
    for (const c of selected) {
      const tag = `${c.platform ? `[${c.platform}] ` : ''}${c.isVideo ? '[video] ' : ''}`;
      console.log(`   ${(c.quality * 100).toFixed(0).padStart(3)}  ${c.shotType.padEnd(10)}  ${tag}${c.file}`);
    }
  })
  .catch((e) => {
    console.error('❌', e.message || e);
    if (e.cause) console.error('   cause:', e.cause.message || e.cause);
    if (e.message === 'fetch failed') {
      console.error(
        '   Likely a network problem downloading model weights on first run: coco-ssd/pose-detection\n' +
        '   pull from storage.googleapis.com, mobilenet from tfhub.dev (@vladmandic/face-api is the\n' +
        '   only one bundled offline). If you\'re on a VPN, try disconnecting it and running again.'
      );
    }
    process.exit(1);
  });
