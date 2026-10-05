#!/usr/bin/env bash
# Run enhance_face.py (next to this file) with the GFPGAN venv built by enhance-face-setup.sh.
# The venv and model weights (~2 GB) live outside the repo, in $ENHANCE_FACE_HOME.
here="$(dirname "$(readlink -f "$0")")"
home="${ENHANCE_FACE_HOME:-$HOME/.local/share/peaha-face}"
if [ ! -x "$home/venv/bin/python" ] && [[ " $* " =~ " -h " || " $* " =~ " --help " ]]; then
  echo "usage: enhance-face [--scale N] [--bg] <image>   (not set up yet: ./install.sh --with-face)"; exit 0
fi
[ -x "$home/venv/bin/python" ] || { echo "enhance-face: not set up, run: $here/enhance-face-setup.sh (or ./install.sh --with-face)" >&2; exit 1; }
unset PYTHONPATH PYTHONHOME
ENHANCE_FACE_HOME="$home" exec "$home/venv/bin/python" "$here/enhance_face.py" "$@"
