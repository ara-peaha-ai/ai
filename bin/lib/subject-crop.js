// Subject-aware crop for `slideshow --fill`: finds people (YOLOX-tiny, COCO
// "person") and faces (YuNet) on CPU with onnxruntime, then places a fixed-size
// cover-crop window so the faces are always inside and as much of the bodies
// as fits. Models are downloaded once into ~/.cache/ai-cli/models and checked
// against pinned sha256 hashes. Licenses: YOLOX Apache-2.0, YuNet MIT.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODELS = {
  person: {
    file: 'yolox_tiny.onnx',
    url: 'https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx',
    sha256: '427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7',
    size: 416,
  },
  face: {
    file: 'face_detection_yunet_2023mar.onnx',
    url: 'https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx',
    sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4',
    size: 640,
  },
};
const PERSON_MIN_SCORE = 0.45;
const FACE_MIN_SCORE = 0.6;
const STRIDES = [8, 16, 32];

const cacheDir = () =>
  path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'ai-cli', 'models');

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// Download a model once, verify it, reuse it afterwards.
const ensureModel = async ({ file, url, sha256: expected }) => {
  const target = path.join(cacheDir(), file);
  if (fs.existsSync(target) && sha256(target) === expected) return target;
  fs.mkdirSync(cacheDir(), { recursive: true });
  console.error(`⬇️  downloading ${file} (once) ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status}): ${url}`);
  const tmp = `${target}.part`;
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  if (sha256(tmp) !== expected) {
    fs.rmSync(tmp);
    throw new Error(`checksum mismatch for ${file}, refusing to use it`);
  }
  fs.renameSync(tmp, target);
  return target;
};

// Raw RGB image -> letterboxed BGR planar float32 tensor of side `size`
// (image at top-left, rest padded), plus the scale back to image pixels.
const toTensor = async (sharp, ort, img, size, pad) => {
  const scale = Math.min(size / img.width, size / img.height);
  const rw = Math.max(1, Math.round(img.width * scale));
  const rh = Math.max(1, Math.round(img.height * scale));
  const { data } = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } })
    .resize(rw, rh, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const plane = size * size;
  const t = new Float32Array(3 * plane).fill(pad);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const s = (y * rw + x) * 3;
      const d = y * size + x;
      t[d] = data[s + 2]; // B
      t[plane + d] = data[s + 1]; // G
      t[2 * plane + d] = data[s]; // R
    }
  }
  return { tensor: new ort.Tensor('float32', t, [1, 3, size, size]), scale };
};

const iou = (a, b) => {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const area = (r) => (r.x2 - r.x1) * (r.y2 - r.y1);
  return inter / (area(a) + area(b) - inter);
};

const nms = (boxes, threshold = 0.45) => {
  const kept = [];
  for (const b of [...boxes].sort((p, q) => q.score - p.score)) {
    if (kept.every((k) => iou(k, b) < threshold)) kept.push(b);
  }
  return kept;
};

// YOLOX output [1, N, 85]: per grid cell (x, y, log w, log h, obj, 80 classes),
// obj/class already sigmoid-ed in the exported model; class 0 = person.
const decodeYolox = (out, size, scale) => {
  const boxes = [];
  let row = 0;
  for (const s of STRIDES) {
    const cells = size / s;
    for (let gy = 0; gy < cells; gy++) {
      for (let gx = 0; gx < cells; gx++, row++) {
        const o = row * 85;
        const score = out[o + 4] * out[o + 5];
        if (score < PERSON_MIN_SCORE) continue;
        const cx = (out[o] + gx) * s;
        const cy = (out[o + 1] + gy) * s;
        const w = Math.exp(out[o + 2]) * s;
        const h = Math.exp(out[o + 3]) * s;
        boxes.push({ x1: (cx - w / 2) / scale, y1: (cy - h / 2) / scale, x2: (cx + w / 2) / scale, y2: (cy + h / 2) / scale, score });
      }
    }
  }
  return nms(boxes);
};

// YuNet 2023mar outputs per stride: cls, obj, bbox (dx, dy, log w, log h);
// score = sqrt(cls * obj), same decoding as OpenCV's FaceDetectorYN.
const decodeYunet = (outs, size, scale) => {
  const boxes = [];
  for (const s of STRIDES) {
    const cols = size / s;
    const cls = outs[`cls_${s}`].data;
    const obj = outs[`obj_${s}`].data;
    const bbox = outs[`bbox_${s}`].data;
    for (let i = 0; i < cls.length; i++) {
      const clamp = (v) => Math.min(1, Math.max(0, v));
      const score = Math.sqrt(clamp(cls[i]) * clamp(obj[i]));
      if (score < FACE_MIN_SCORE) continue;
      const cx = ((i % cols) + bbox[i * 4]) * s;
      const cy = (Math.floor(i / cols) + bbox[i * 4 + 1]) * s;
      const w = Math.exp(bbox[i * 4 + 2]) * s;
      const h = Math.exp(bbox[i * 4 + 3]) * s;
      boxes.push({ x1: (cx - w / 2) / scale, y1: (cy - h / 2) / scale, x2: (cx + w / 2) / scale, y2: (cy + h / 2) / scale, score });
    }
  }
  return nms(boxes, 0.3);
};

// Lazily load both models once per process.
let sessions = null;
const loadSessions = async () => {
  if (sessions) return sessions;
  const ort = require('onnxruntime-node');
  const [person, face] = await Promise.all([ensureModel(MODELS.person), ensureModel(MODELS.face)]);
  sessions = {
    ort,
    person: await ort.InferenceSession.create(person),
    face: await ort.InferenceSession.create(face),
  };
  return sessions;
};

// Free the models (~200 MB) before the encoder starts.
const releaseModels = async () => {
  if (!sessions) return;
  await Promise.all([sessions.person.release(), sessions.face.release()]);
  sessions = null;
};

// img = { data: raw RGB Buffer, width, height } -> { persons, faces } in image pixels
const detect = async (sharp, img) => {
  const { ort, person, face } = await loadSessions();
  const p = await toTensor(sharp, ort, img, MODELS.person.size, 114);
  const persons = decodeYolox((await person.run({ images: p.tensor })).output.data, MODELS.person.size, p.scale);
  const f = await toTensor(sharp, ort, img, MODELS.face.size, 0);
  const faces = decodeYunet(await face.run({ input: f.tensor }), MODELS.face.size, f.scale);
  return { persons, faces };
};

const union = (boxes) =>
  boxes.length === 0
    ? null
    : {
        x1: Math.min(...boxes.map((b) => b.x1)),
        y1: Math.min(...boxes.map((b) => b.y1)),
        x2: Math.max(...boxes.map((b) => b.x2)),
        y2: Math.max(...boxes.map((b) => b.y2)),
      };

const area = (b) => (b.x2 - b.x1) * (b.y2 - b.y1);

// Keep the main subjects: boxes at least `ratio` the area of the biggest one,
// so a crowd in the background does not pull the crop away from the subject.
const mainOnes = (boxes, ratio) => {
  const biggest = Math.max(0, ...boxes.map(area));
  return boxes.filter((b) => area(b) >= biggest * ratio);
};

// Pure geometry, no I/O: image WxH + detections + output aspect (ow:oh) ->
// the cover-crop window { left, top, width, height }, or null when nothing
// was detected (caller falls back to the attention heuristic).
// The window always has the largest size of that aspect that fits the image,
// so only its start along one axis is chosen:
// - faces that do not fit together: keep the biggest face and its person;
// - the subject (main people + faces) fits: centered on it;
// - it does not fit: horizontally centered on it, vertically the faces sit
//   near the top with the body below;
// - the faces are always kept inside (a face bigger than the window is centered).
const subjectCrop = (W, H, ow, oh, { persons, faces }) => {
  let people = mainOnes(persons, 0.3);
  let heads = mainOnes(faces, 0.25);
  if (people.length === 0 && heads.length === 0) return null;
  const horizontal = W / H > ow / oh;
  const cw = horizontal ? Math.round((H * ow) / oh) : W;
  const ch = horizontal ? H : Math.round((W * oh) / ow);
  const [lo, hi, len, max] = horizontal ? ['x1', 'x2', cw, W] : ['y1', 'y2', ch, H];
  const spanOf = (b) => b[hi] - b[lo];
  const midOf = (b) => (b[lo] + b[hi]) / 2;

  if (heads.length > 1 && spanOf(union(heads)) > len) {
    const big = heads.reduce((a, b) => (area(b) > area(a) ? b : a));
    const [cx, cy] = [(big.x1 + big.x2) / 2, (big.y1 + big.y2) / 2];
    heads = [big];
    people = people.filter((p) => p.x1 <= cx && cx <= p.x2 && p.y1 <= cy && cy <= p.y2);
  }
  const subject = union([...people, ...heads]);
  const face = union(heads);

  let start;
  if (spanOf(subject) <= len || horizontal) start = midOf(subject) - len / 2;
  else start = (face ? face.y1 : subject.y1) - 0.08 * len; // headroom above the face
  if (face && spanOf(face) > len) start = midOf(face) - len / 2;
  else if (face) start = Math.min(Math.max(start, face[hi] - len), face[lo]);
  start = Math.round(Math.min(Math.max(start, 0), max - len));
  return horizontal
    ? { left: start, top: 0, width: cw, height: ch }
    : { left: 0, top: start, width: cw, height: ch };
};

module.exports = { detect, subjectCrop, ensureModel, releaseModels, MODELS };
