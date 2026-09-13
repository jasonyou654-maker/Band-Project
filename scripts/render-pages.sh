#!/usr/bin/env sh
set -eu

output_dir=dist/client
mkdir -p "$output_dir"

# `vinext build` with `output: "export"` already prerenders `/` to this
# artifact. Do not start the production server here: GitHub Pages needs the
# generated HTML, and the server does not mount the repository prefix.
if [ ! -s "$output_dir/index.html" ]; then
  echo "Expected static export at $output_dir/index.html" >&2
  exit 1
fi

# GitHub Pages adds `/Band-Project` externally, while Vinext emits absolute
# asset URLs from `/assets`. Use a temporary file so this works on both macOS
# BSD sed and Linux GNU sed.
tmp_file="$output_dir/index.html.tmp"
sed 's#"/assets/#"/Band-Project/assets/#g' "$output_dir/index.html" >"$tmp_file"
mv "$tmp_file" "$output_dir/index.html"
