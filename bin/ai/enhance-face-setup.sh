#!/usr/bin/env bash
# CPU-only face-restoration stack for enhance-face (GFPGAN v1.4). Re-runnable / idempotent.
# Builds the venv and downloads the weights into $ENHANCE_FACE_HOME (~2 GB, outside the repo).
# WITH_BG=1 also downloads Real-ESRGAN x2 for `enhance-face --bg`.
set -euo pipefail

HERE="${ENHANCE_FACE_HOME:-$HOME/.local/share/peaha-face}"
V="$HERE/venv/bin"
mkdir -p "$HERE"
cd "$HERE"

[ -d venv ] || python3 -m venv venv
"$V/pip" install -q --upgrade pip wheel

# CPU build of torch — no CUDA / nvidia-* packages
"$V/pip" install -q --index-url https://download.pytorch.org/whl/cpu torch torchvision

# restoration stack (numpy pinned <2: basicsr/gfpgan predate numpy 2)
"$V/pip" install -q "numpy<2" opencv-python-headless gfpgan realesrgan

# basicsr imports a torchvision path removed in torchvision>=0.17 — patch in place.
# (locate by path, not by importing basicsr: the broken import is what we're fixing)
DEG="$(find "$HERE/venv" -path '*/basicsr/data/degradations.py')"
sed -i 's/torchvision\.transforms\.functional_tensor/torchvision.transforms.functional/' "$DEG"

# model weights
mkdir -p weights
[ -s weights/GFPGANv1.4.pth ] || curl -fL --retry 3 -o weights/GFPGANv1.4.pth \
  https://github.com/TencentARC/GFPGAN/releases/download/v1.3.4/GFPGANv1.4.pth
if [ "${WITH_BG:-}" = 1 ] && [ ! -s weights/RealESRGAN_x2plus.pth ]; then
  curl -fL --retry 3 -o weights/RealESRGAN_x2plus.pth \
    https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth
fi

echo "ok: enhance-face stack ready in $HERE"
