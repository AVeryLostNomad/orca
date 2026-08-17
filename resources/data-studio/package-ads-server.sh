#!/usr/bin/env bash
# Package a built Azure Data Studio web-server tree (from install-ads-server.sh)
# into the distributable tarball Orca's installer downloads from GitHub releases.
#
# What packaging does beyond the build:
#   - inclusion-based staging: out/, node_modules/, extensions/ (with each
#     extension's node_modules reduced to production deps), resources/,
#     product.json, product.overrides.json, package.json, .build/node/<ver>,
#     and the remote/web/node_modules -> ../../node_modules symlink
#   - strips foreign-platform tools-service payloads (Windows*/Linux*/OSX_64)
#   - hardlink-dedupes identical files (~25 extensions each vendor the same
#     AppInsights/OpenTelemetry stack; tar stores hardlinked content once)
#   - boot-tests the staged tree before tarring (caller responsibility: see
#     the smoke commands in the header of install-ads-server.sh)
#
# Usage: package-ads-server.sh --source <built-ads-root> --out <tarball.tar.gz>
# Publish (note --notes: without it gh goes interactive and can choke on
# terminal escape sequences):
#   gh release create ads-web-server-v1.53.0-orca.N <tarball> \
#     --repo AVeryLostNomad/orca --title "ADS web server 1.53.0-orca.N" \
#     --notes "Prebuilt ADS web server for Orca's Data Studio tab."
# Keep the repo/tag/asset name in sync with src/main/data-studio/ads-server-installer.ts.
set -euo pipefail

SOURCE=""
OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$SOURCE" && -n "$OUT" ]] || { echo "usage: $0 --source <ads-root> --out <tar.gz>" >&2; exit 2; }
[[ -e "$SOURCE/out/server-main.js" ]] || { echo "$SOURCE is not a built ADS tree" >&2; exit 2; }

WORK="$(mktemp -d)/ads"
mkdir -p "$WORK"
rsync -a "$SOURCE/out/" "$WORK/out/"
rsync -a "$SOURCE/node_modules/" "$WORK/node_modules/"
rsync -a "$SOURCE/extensions/" "$WORK/extensions/"
rsync -a "$SOURCE/resources/" "$WORK/resources/"
cp "$SOURCE/product.json" "$SOURCE/product.overrides.json" "$SOURCE/package.json" "$WORK/"
mkdir -p "$WORK/.build"
rsync -a "$SOURCE/.build/node" "$WORK/.build/"
mkdir -p "$WORK/remote/web"
ln -sfn ../../node_modules "$WORK/remote/web/node_modules"

# Per-extension production-only node_modules (their yarn installs include the
# full dev toolchain). Extensions whose reinstall fails keep the original tree.
export npm_config_audit=false npm_config_fund=false
for ext in "$WORK"/extensions/*/; do
  ext="${ext%/}"
  [[ -f "$ext/package.json" && -d "$ext/node_modules" ]] || continue
  deps="$(node -e "console.log(Object.keys(require('$ext/package.json').dependencies ?? {}).length)")"
  if [[ "$deps" == "0" ]]; then
    rm -rf "$ext/node_modules"
  else
    (cd "$ext" && rm -rf node_modules && npm install --omit=dev --ignore-scripts --silent) \
      || rsync -a "$SOURCE/extensions/$(basename "$ext")/node_modules/" "$ext/node_modules/"
  fi
done

# Foreign-platform tools-service payloads.
find "$WORK/extensions" -maxdepth 5 -type d \( -name 'Windows*' -o -name 'Linux*' -o -name 'OSX_64' \) -exec rm -rf {} + 2>/dev/null || true
if [[ "$(uname -m)" == "arm64" ]]; then
  find "$WORK/extensions" -maxdepth 5 -type d -path '*sqltoolsservice*' -name 'OSX' -exec rm -rf {} + 2>/dev/null || true
fi

# Hardlink-dedupe identical files so tar stores each payload once.
python3 - "$WORK" <<'PY'
import hashlib, os, sys
root = sys.argv[1]
seen = {}
for base in ("extensions", "node_modules"):
    for dirpath, _dirnames, filenames in os.walk(os.path.join(root, base)):
        for name in filenames:
            p = os.path.join(dirpath, name)
            try:
                st = os.lstat(p)
            except OSError:
                continue
            if not os.path.isfile(p) or os.path.islink(p) or st.st_size < 8192:
                continue
            with open(p, "rb") as f:
                digest = hashlib.sha256(f.read()).hexdigest()
            key = (digest, st.st_size)
            if key in seen and os.lstat(seen[key]).st_ino != st.st_ino:
                tmp = p + ".orca-ln-tmp"
                os.link(seen[key], tmp)
                os.replace(tmp, p)
            else:
                seen.setdefault(key, p)
PY

tar -czf "$OUT" -C "$(dirname "$WORK")" ads
echo "Packaged: $OUT ($(du -h "$OUT" | cut -f1))"
