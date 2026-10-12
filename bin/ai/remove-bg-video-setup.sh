#!/usr/bin/env bash
# CPU-only video matting stack for remove-bg-video (RobustVideoMatting). Re-runnable / idempotent.
# Builds the venv and downloads the weights into $REMOVE_BG_VIDEO_HOME (~1 GB, outside the repo).
set -euo pipefail

HERE="${REMOVE_BG_VIDEO_HOME:-$HOME/.local/share/peaha-rvm}"
V="$HERE/venv/bin"
mkdir -p "$HERE"
cd "$HERE"

[ -d venv ] || python3 -m venv venv
"$V/python" -c 'import sys; sys.exit(not (3, 10) <= sys.version_info[:2] < (3, 14))' \
  || { echo "remove-bg-video: needs python 3.10-3.13 (numpy 2.2.6 wheels)" >&2; exit 1; }
"$V/pip" install -q --upgrade pip wheel

# CPU build of torch — no CUDA / nvidia-* packages; versions as tested 2026-10-10
"$V/pip" install -q --index-url https://download.pytorch.org/whl/cpu torch==2.14.1
"$V/pip" install -q numpy==2.2.6  # last line supporting python 3.10

# model weights (RVM is GPL-3.0: run as a tool, never bundled into something we distribute)
mkdir -p weights
# TorchScript load runs code from the file: pin its hash, re-fetch anything that does not match
SHA=f01e0c9338b9a6a31b881ea6d4360d70c1e549701b3792e14c9ed88d6196c5a1
F=weights/rvm_mobilenetv3_fp32.torchscript
if ! echo "$SHA  $F" | sha256sum -c --status 2>/dev/null; then
  curl -fL --retry 3 -o "$F.part" https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.torchscript
  echo "$SHA  $F.part" | sha256sum -c --status || { rm -f -- "$F.part"; echo "remove-bg-video: weights hash mismatch, not installed" >&2; exit 1; }
  mv -- "$F.part" "$F"
fi

echo "ok: remove-bg-video stack ready in $HERE"
