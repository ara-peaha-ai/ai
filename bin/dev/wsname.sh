#!/usr/bin/env bash
# wsname: name (or rename) a VS Code workspace and show that name, instead of the
# open file, in the window title / dock hover.
#
# Usage:
#   wsname                                -> the only *.code-workspace in the current folder
#   wsname foobar                         -> the only *.code-workspace here, renamed to foobar.code-workspace
#   wsname path/to/file.code-workspace foobar

set -euo pipefail

find_single_workspace() {
  local matches=()
  while IFS= read -r -d '' f; do matches+=("$f"); done < <(find . -maxdepth 1 -name '*.code-workspace' -print0)
  if [ "${#matches[@]}" -eq 0 ]; then
    echo "No .code-workspace file in this folder." >&2
    exit 1
  elif [ "${#matches[@]}" -gt 1 ]; then
    echo "More than one .code-workspace here, name the file: wsname <file.code-workspace> [new-name]" >&2
    exit 1
  fi
  echo "${matches[0]}"
}

file=""
newname=""

if [ $# -eq 0 ]; then
  file="$(find_single_workspace)"
elif [ $# -eq 1 ]; then
  if [[ "$1" == *.code-workspace ]]; then
    file="$1"
  else
    file="$(find_single_workspace)"
    newname="$1"
  fi
else
  file="$1"
  newname="$2"
fi

if [ ! -f "$file" ]; then
  echo "File not found: $file" >&2
  exit 1
fi

if [ -n "$newname" ]; then
  dir="$(dirname "$file")"
  target="$dir/$newname.code-workspace"
  mv -n "$file" "$target"
  file="$target"
  echo "Renamed to: $file"
fi

tmp="$(mktemp)"
jq '.settings["window.title"] = "${rootName}"' "$file" > "$tmp"
mv "$tmp" "$file"

echo "Done: $(basename "${file%.code-workspace}") is now the name shown in the title/dock."
