#!/usr/bin/env bash
# ScCode manager (Git Bash on Windows).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
require() { command -v "$1" >/dev/null 2>&1 || { echo "Missing tool: $1" >&2; exit 1; }; }
case "${1:-help}" in
  setup) require node; require npm; npm ci --ignore-scripts --no-audit --no-fund ;;
  dev) require npm; npm run desktop:dev ;;
  web) require npm; npm run dev ;;
  build) require npm; npm run build ;;
  test) require npm; require cargo; npm test; npm run test:transport; npm run typecheck; cargo test -p sc-code-runtime -p sc-code-auth -p sc-code-workspace -p sc-code-agent -p sc-code-settings -p sc-code-extensions; cargo test -p sc-code --lib; bash check-docs.sh ;;
  check) require cargo; cargo check -p sc-code ;;
  package) require npm; npm run desktop:package ;;
  docs) bash check-docs.sh ;;
  help|-h|--help) printf 'ScCode manager (Git Bash on Windows)\n  setup  install JS dependencies\n  dev    desktop development\n  web    browser workbench development\n  build  frontend production build\n  test   Node/TS/native core regression\n  check  native application compile check\n  package  installer build (requires prepared Node/Go/extensions)\n  docs   documentation checks\n' ;;
  *) echo "Unknown command: $1" >&2; exit 2 ;;
esac
