#!/usr/bin/env bash
# CPU-only video matting stack for remove-bg-video (RobustVideoMatting). Re-runnable / idempotent.
# Builds the venv and downloads the weights into $REMOVE_BG_VIDEO_HOME (~1 GB, outside the repo).
set -euo pipefail

HERE="${REMOVE_BG_VIDEO_HOME:-$HOME/.local/share/peaha-rvm}"
V="$HERE/venv/bin"
mkdir -p "$HERE"
cd "$HERE"

[ -d venv ] || python3 -m venv venv
"$V/pip" install -q --upgrade pip wheel

# CPU build of torch — no CUDA / nvidia-* packages; versions as tested 2026-10-10
"$V/pip" install -q --index-url https://download.pytorch.org/whl/cpu torch==2.14.1
"$V/pip" install -q numpy==2.2.6  # last line supporting python 3.10

# model weights (RVM is GPL-3.0: run as a tool, never bundled into something we distribute)
mkdir -p weights
# download to .part and rename, so an interrupted curl never leaves a file that looks ready
fetch() { [ -s "weights/$1" ] || { curl -fL --retry 3 -o "weights/$1.part" "$2" && mv "weights/$1.part" "weights/$1"; }; }
fetch rvm_mobilenetv3_fp32.torchscript https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.torchscript

echo "ok: remove-bg-video stack ready in $HERE"
