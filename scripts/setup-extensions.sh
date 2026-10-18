#!/usr/bin/env bash
# Never copy a user's private extension collection or uncompiled VS Code sources.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
node scripts/prepare-desktop-runtime.cjs
node scripts/generate-extension-meta.js
