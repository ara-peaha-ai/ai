#!/usr/bin/env python3
"""CPU video background removal for people via RobustVideoMatting (mobilenetv3).

Cuts the person out of every frame, keeps the audio. People only: other
objects are treated as background. Runs entirely on CPU, ~5 fps at 720p on
6 cores.

Output: <name>-nobg.webm next to the input (VP9 with alpha channel).
"""
import argparse
import json
import os
import subprocess
import sys
import time

# venv + weights live outside the repo (set by the remove-bg-video wrapper)
HERE = os.environ.get("REMOVE_BG_VIDEO_HOME", os.path.expanduser("~/.local/share/peaha-rvm"))
MODEL = os.path.join(HERE, "weights", "rvm_mobilenetv3_fp32.torchscript")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="video file (anything ffmpeg reads)")
    a = ap.parse_args()

    src = os.path.abspath(a.input)
    if not os.path.isfile(src):
        sys.exit(f"no such file: {a.input}")
    if not os.path.isfile(MODEL):
        sys.exit(f"missing model: {MODEL} (run remove-bg-video-setup.sh)")
    dst = f"{os.path.splitext(src)[0]}-nobg.webm"
    part = dst + ".part"

    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
                            "-show_entries", "stream=width,height,r_frame_rate", "-of", "json", src],
                           capture_output=True, text=True)
    streams = json.loads(probe.stdout or "{}").get("streams")
    if probe.returncode or not streams:
        sys.exit(f"no video stream in: {a.input}")
    w, h, fps = streams[0]["width"], streams[0]["height"], streams[0]["r_frame_rate"]
    # RVM docs: downsample so the long side is ~512px for the coarse pass
    ratio = min(512 / max(w, h), 1.0)

    import torch

    torch.set_num_threads(len(os.sched_getaffinity(0)))  # cpus actually assigned, not host total
    model = torch.jit.load(MODEL).eval()

    dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", src, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                           stdout=subprocess.PIPE)
    # realtime VP9: default "good" deadline halves the whole pipeline speed
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y",
                            "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{w}x{h}", "-r", fps, "-i", "-",
                            "-i", src, "-map", "0:v", "-map", "1:a?",
                            "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-crf", "32", "-b:v", "0",
                            "-row-mt", "1", "-deadline", "realtime", "-cpu-used", "8",
                            "-c:a", "libopus", "-f", "webm", part], stdin=subprocess.PIPE)

    frame_bytes = w * h * 3
    rec = [None] * 4
    n, t0 = 0, time.time()
    with torch.inference_mode():
        # one frame per pass: the TorchScript export rejects [B,T,...] input with empty recurrent state
        while (buf := dec.stdout.read(frame_bytes)) and len(buf) == frame_bytes:
            x = torch.frombuffer(bytearray(buf), dtype=torch.uint8).view(1, h, w, 3).permute(0, 3, 1, 2).float().div(255)
            fgr, pha, *rec = model(x, *rec, ratio)
            rgba = torch.cat([fgr, pha], dim=1)[0].mul(255).byte().permute(1, 2, 0).contiguous()
            enc.stdin.write(rgba.numpy().tobytes())
            n += 1

    enc.stdin.close()
    if enc.wait() or dec.wait() or n == 0:
        sys.exit(f"failed after {n} frames, {dst} not written")
    os.replace(part, dst)  # dst appears only when complete
    print(f"{n} frames in {time.time() - t0:.0f}s", file=sys.stderr)
    print(dst)


if __name__ == "__main__":
    main()
