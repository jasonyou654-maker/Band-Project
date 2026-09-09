#!/usr/bin/env sh
set -eu

port=4173
output_dir=dist/client
node_binary=${NODE_BINARY:-node}

"$node_binary" node_modules/vinext/dist/cli.js start --port "$port" >/tmp/bandproject-pages-render.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT

attempt=0
while [ "$attempt" -lt 20 ]; do
  if curl --fail --silent --show-error "http://127.0.0.1:$port/Band-Project/" >"$output_dir/index.html"; then
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 1
done

cat /tmp/bandproject-pages-render.log >&2
exit 1
