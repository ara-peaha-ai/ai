#!/usr/bin/env python3
"""CPU face restoration / upscale via GFPGAN v1.4.

Rebuilds facial detail on low-res or compressed portraits (something a plain
Lanczos resample like `upscale` cannot do). Runs entirely on CPU.

Output: <name>@<N>x-face.<ext> next to the input.
"""
import argparse
import os
import sys

import cv2

# venv + weights live outside the repo (set by the enhance-face wrapper)
HERE = os.environ.get("ENHANCE_FACE_HOME", os.path.expanduser("~/.local/share/peaha-face"))
WEIGHTS = os.path.join(HERE, "weights")
GFPGAN_MODEL = os.path.join(WEIGHTS, "GFPGANv1.4.pth")
BG_MODEL = os.path.join(WEIGHTS, "RealESRGAN_x2plus.pth")


def build_bg_upsampler():
    """Real-ESRGAN x2 for the non-face background. Slow on CPU, opt-in."""
    from basicsr.archs.rrdbnet_arch import RRDBNet
    from realesrgan import RealESRGANer

    model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64,
                    num_block=23, num_grow_ch=32, scale=2)
    return RealESRGANer(scale=2, model_path=BG_MODEL, model=model,
                        tile=400, tile_pad=10, pre_pad=0, half=False)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="image file (jpg/png/webp)")
    ap.add_argument("--scale", type=int, default=2,
                    help="output size factor, >1 (default 2)")
    ap.add_argument("--bg", action="store_true",
                    help="also upscale the background with Real-ESRGAN (much slower on CPU)")
    a = ap.parse_args()

    if a.scale < 2:
        sys.exit("--scale must be > 1")
    src = os.path.abspath(a.input)
    if not os.path.isfile(src):
        sys.exit(f"no such file: {a.input}")
    if not os.path.isfile(GFPGAN_MODEL):
        sys.exit(f"missing model: {GFPGAN_MODEL} (run enhance-face-setup.sh)")
    if a.bg and not os.path.isfile(BG_MODEL):
        sys.exit(f"missing model: {BG_MODEL} (run WITH_BG=1 enhance-face-setup.sh)")

    img = cv2.imread(src, cv2.IMREAD_COLOR)
    if img is None:
        sys.exit(f"cannot read image: {a.input}")

    # GFPGAN/facexlib cache their detection weights under a relative
    # "gfpgan/weights" — run from HERE so that lands in the install dir,
    # not wherever the user happened to call the command from.
    os.chdir(HERE)

    from gfpgan import GFPGANer

    restorer = GFPGANer(
        model_path=GFPGAN_MODEL,
        upscale=a.scale,
        arch="clean",
        channel_multiplier=2,
        bg_upsampler=build_bg_upsampler() if a.bg else None,
    )

    _, _, output = restorer.enhance(
        img, has_aligned=False, only_center_face=False, paste_back=True
    )

    root, ext = os.path.splitext(src)
    if ext.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
        ext = ".png"
    dst = f"{root}@{a.scale}x-face{ext}"
    if not cv2.imwrite(dst, output):
        sys.exit(f"cannot write: {dst}")
    print(dst)


if __name__ == "__main__":
    main()
