#!/usr/bin/env bash
# Adapted from vibe-coding-starter's manager.sh to ScCode's actual toolchain.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
require() { command -v "$1" >/dev/null 2>&1 || { echo "Missing tool: $1" >&2; exit 1; }; }
case "${1:-help}" in
  setup) require node; require npm; npm ci --ignore-scripts --no-audit --no-fund; npm run verify:import ;;
  dev) require npm; npm run desktop:dev ;;
  web) require npm; npm run dev ;;
  build) require npm; npm run build ;;
  test) require npm; require cargo; npm run verify:import; npm test; npm run test:transport; npm run typecheck; cargo test -p sc-code-runtime -p sidex-auth -p sidex-workspace -p sidex-agent -p sidex-settings -p sidex-extensions; cargo test -p sc-code --lib; bash check-docs.sh ;;
  check) require cargo; cargo check -p sc-code ;;
  pack) require npm; npm run desktop:build ;;
  docs) bash check-docs.sh ;;
  help|-h|--help) printf 'ScCode manager (Git Bash on Windows)\n  setup  install JS dependencies and verify provenance\n  dev    desktop development\n  web    browser workbench development\n  build  frontend production build\n  test   import/Node/TS/native core regression\n  check  native application compile check\n  pack   installer build (requires prepared Node/Go/extensions)\n  docs   starter documentation checks\n' ;;
  *) echo "Unknown command: $1" >&2; exit 2 ;;
esac
