#!/usr/bin/env bash
# Run remove_bg_video.py (next to this file) with the venv built by remove-bg-video-setup.sh.
# The venv and model weights (~1 GB) live outside the repo, in $REMOVE_BG_VIDEO_HOME.
here="$(dirname "$(readlink -f "$0")")"
home="${REMOVE_BG_VIDEO_HOME:-$HOME/.local/share/peaha-rvm}"
if [ ! -x "$home/venv/bin/python" ] && [[ " $* " =~ " -h " || " $* " =~ " --help " ]]; then
  echo "usage: remove-bg-video <video>   (not set up yet: ./install.sh --with-bg-video)"; exit 0
fi
[ -x "$home/venv/bin/python" ] || { echo "remove-bg-video: not set up, run: $here/remove-bg-video-setup.sh (or ./install.sh --with-bg-video)" >&2; exit 1; }
unset PYTHONPATH PYTHONHOME
REMOVE_BG_VIDEO_HOME="$home" exec "$home/venv/bin/python" "$here/remove_bg_video.py" "$@"
