#!/usr/bin/env sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec "${PYTHON_BIN:-python3}" "$project_dir/tools/omr_service.py"
