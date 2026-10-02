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

# GitHub Pages cannot run the account, storage, and OMR APIs. Forward every
# static route to the complete hosted app, preserving the requested path.
redirect_page="$output_dir/404.html"
cat >"$redirect_page" <<'EOF'
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Opening BandProject</title></head><body><p>Opening the full BandProject score platform…</p><p><a href="https://studio17.callumyou654.chatgpt.site/">Continue to BandProject</a></p><script>
const path = location.pathname.replace(/^\/Band-Project(?=\/|$)/, "") || "/";
location.replace("https://studio17.callumyou654.chatgpt.site" + path + location.search + location.hash);
</script></body></html>
EOF
find "$output_dir" -name '*.html' ! -name '404.html' -type f -exec cp "$redirect_page" '{}' \;
