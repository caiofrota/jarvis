#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo 'Instale Node.js 22.12 ou superior.'; exit 1; }
[ -d node_modules/next ] || { echo 'Execute pnpm install primeiro.'; exit 1; }
exec node node_modules/tsx/dist/cli.mjs watch --ignore dist --ignore out scripts/dev.ts
