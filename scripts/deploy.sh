#!/usr/bin/env bash
# Build the SPA and publish it together with the Spacefast Functions worker.
#
#   scripts/deploy.sh            # build + publish to the linked space
#
# Layout: the React app (repo root, src/) builds to dist/. The worker lives in
# spacefast/. We assemble deploy/ = dist static files + worker files, and inject
# the built index.html into the worker's fallback so client-side routes and hard
# refreshes serve the SPA shell (the worker is the catch-all for no-file paths;
# it must hand back index.html for anything that is not /api/*).
set -euo pipefail
cd "$(dirname "$0")/.."

SPACE="${SPACEFAST_SPACE:-spc_b10a5fd8fe594973a7c523e99eb711f6}"
MSG="${1:-deploy}"

echo "==> building SPA"
npm run build

echo "==> assembling deploy/"
rm -rf deploy && mkdir deploy
cp -R dist/. deploy/
# All worker modules + config (handler.ts imports the rest; the bundler follows).
cp spacefast/*.ts spacefast/sf.jsonc deploy/
# The old interim vanilla SPA is not part of the worker build.
rm -f deploy/index.html.bak

echo "==> injecting SPA shell into worker fallback"
python3 - <<'PY'
import re
html = open("deploy/index.html").read()
esc = html.replace("\\","\\\\").replace("`","\\`").replace("${","\\${")
h = open("deploy/handler.ts").read()
h2 = re.sub(r"const LANDING = `.*?`;", "const LANDING = `" + esc + "`;", h, count=1, flags=re.S)
assert h2 != h, "LANDING marker not found in handler.ts"
open("deploy/handler.ts","w").write(h2)
PY

echo "==> publishing to $SPACE"
sf publish ./deploy --space "$SPACE" --yes --message "$MSG"
