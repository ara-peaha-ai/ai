#!/usr/bin/env python3
"""CPU video background removal for people via RobustVideoMatting (mobilenetv3).

Cuts the person out of every frame, keeps the audio (re-encoded to Opus).
Person matting: the background drops, objects touching the person can stay.
Runs entirely on CPU, ~5 fps at 720p on 6 cores.

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

    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_streams", "-of", "json", src],
                           capture_output=True, text=True)
    streams = json.loads(probe.stdout or "{}").get("streams")
    if probe.returncode or not streams:
        sys.exit(f"no video stream in: {a.input}")
    st = streams[0]
    w, h = st["width"], st["height"]
    # ffmpeg autorotates phone clips: rotation lives in side data (ffmpeg 5+) or the rotate tag (4.x)
    rot = next((d["rotation"] for d in st.get("side_data_list", []) if "rotation" in d), st.get("tags", {}).get("rotate", 0))
    if int(float(rot)) % 180:
        w, h = h, w
    fps = st["r_frame_rate"] if st.get("r_frame_rate", "0/0") != "0/0" else st.get("avg_frame_rate", "25/1")
    # RVM auto default: long side ~512px for the coarse pass (its docs suggest more for full-body shots)
    ratio = min(512 / max(w, h), 1.0)

    import torch

    torch.set_num_threads(len(os.sched_getaffinity(0)))  # cpus actually assigned, not host total
    model = torch.jit.load(MODEL).eval()

    # scale to the probed size so a wrong guess can never shift the rows of the raw frames
    dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", src, "-map", "0:v:0", "-vf", f"scale={w}:{h}", "-r", fps,
                            "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
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
    n, t0, ok = 0, time.time(), False
    try:
        with torch.inference_mode():
            # one frame per pass: the TorchScript export rejects [B,T,...] input with empty recurrent state
            while (buf := dec.stdout.read(frame_bytes)) and len(buf) == frame_bytes:
                x = torch.frombuffer(bytearray(buf), dtype=torch.uint8).view(1, h, w, 3).permute(0, 3, 1, 2).float().div(255)
                fgr, pha, *rec = model(x, *rec, ratio)
                rgba = torch.cat([fgr, pha], dim=1)[0].mul(255).byte().permute(1, 2, 0).contiguous()
                enc.stdin.write(rgba.numpy().tobytes())
                n += 1
        enc.stdin.close()
        ok = not (enc.wait() | dec.wait()) and n > 0  # | not or: always reap both
    except BrokenPipeError:
        pass
    finally:
        for p in (dec, enc):
            p.kill()
            p.wait()
        if not ok and os.path.exists(part):
            os.remove(part)
    if not ok:
        sys.exit(f"failed after {n} frames, {dst} not written")
    os.replace(part, dst)  # dst appears only when complete
    print(f"{n} frames in {time.time() - t0:.0f}s", file=sys.stderr)
    print(dst)


if __name__ == "__main__":
    main()
