#!/usr/bin/env bash
# CI build of the Azure Data Studio web-server artifact for one platform.
# Runs on GitHub Actions runners (macOS / Ubuntu-20.04 container / Windows
# git-bash) — see .github/workflows/ads-server-artifacts.yml. Mirrors
# install-ads-server.sh + package-ads-server.sh in one self-contained pass.
#
# Differences from the hand-built artifact:
#   - mssql/kusto/azuremonitor tools services are NOT pre-bundled (they only
#     exist after a first activation); they self-download from GitHub releases
#     at runtime, exactly like desktop ADS did on first run.
#   - pgsql IS pre-bundled via Microsoft's platform vsix where one exists
#     (linux-arm64 gets the generic vsix; its service self-downloads).
#   - win32: remote/web/node_modules is a real copy (tar symlinks need
#     privileges on Windows); hardlink dedupe keeps the archive small.
#
# Usage: ci-build-ads-server.sh --platform darwin|linux|win32 --arch arm64|x64 \
#          --node-dist <nodejs.org dist name, e.g. darwin-arm64|linux-x64|win-x64> \
#          --version <artifact version, e.g. 1.53.0-orca.1> --out <tar.gz path>
set -euo pipefail

ADS_REPO="https://github.com/microsoft/azuredatastudio.git"
ADS_COMMIT="38c5d45a3aed1015dc05ea9dd209c6433f1f3ed5"
ADS_NODE_VERSION="20.16.0"
PGSQL_VERSION="0.6.0"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_FILE="$SCRIPT_DIR/ads-orca-web-server.patch"
PYTHON_BIN="$(command -v python3 || command -v python)"

PLATFORM="" ARCH="" NODE_DIST="" VERSION="" OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    --node-dist) NODE_DIST="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$PLATFORM" && -n "$ARCH" && -n "$NODE_DIST" && -n "$VERSION" && -n "$OUT" ]] || {
  echo "usage: $0 --platform <p> --arch <a> --node-dist <d> --version <v> --out <tar.gz>" >&2
  exit 2
}
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"

WORK="${RUNNER_TEMP:-/tmp}/ads-build"
rm -rf "$WORK"
mkdir -p "$WORK"
cd "$WORK"

echo "::group::Clone azuredatastudio@$ADS_COMMIT"
git config --global core.longpaths true || true
git clone --depth 1 "$ADS_REPO" ads
cd ads
if [[ "$(git rev-parse HEAD)" != "$ADS_COMMIT" ]]; then
  git fetch --depth 1 origin "$ADS_COMMIT" && git checkout -q "$ADS_COMMIT"
fi
echo "::endgroup::"

echo "::group::Apply Orca patches"
# admin-tool-ext-win eagerly downloads SsmsMin from a decommissioned Azure blob.
node -e '
const fs = require("fs");
const p = "extensions/admin-tool-ext-win/package.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
if (j.scripts && j.scripts.postinstall) {
  j.scripts.postinstall = "node -e \"process.exit(0)\"";
  fs.writeFileSync(p, JSON.stringify(j, null, "\t") + "\n");
}
'
git apply "$PATCH_FILE"
cat > product.overrides.json <<'JSON'
{
	"version": "1.53.0",
	"vscodeVersion": "1.82.0",
	"date": "2026-08-17T00:00:00.000Z"
}
JSON
echo "::endgroup::"

echo "::group::PostgreSQL builtin (azuredatastudio-postgresql $PGSQL_VERSION)"
case "$PLATFORM-$ARCH" in
  darwin-arm64) PGSQL_ASSET="azuredatastudio-postgresql-$PGSQL_VERSION-osx-arm64.vsix" ;;
  darwin-x64) PGSQL_ASSET="azuredatastudio-postgresql-$PGSQL_VERSION-osx.vsix" ;;
  linux-x64) PGSQL_ASSET="azuredatastudio-postgresql-$PGSQL_VERSION-linux-x64.vsix" ;;
  win32-x64) PGSQL_ASSET="azuredatastudio-postgresql-$PGSQL_VERSION-win-x64.vsix" ;;
  *) PGSQL_ASSET="azuredatastudio-postgresql-$PGSQL_VERSION.vsix" ;; # generic: service self-downloads
esac
# NOTE: no /tmp here — native curl.exe/python on Windows do not understand
# git-bash's virtual /tmp. $WORK is a real path on every OS.
curl -sL -o "$WORK/pgsql.vsix" "https://github.com/microsoft/azuredatastudio-postgresql/releases/download/v$PGSQL_VERSION/$PGSQL_ASSET"
"$PYTHON_BIN" -c "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$WORK/pgsql.vsix" "$WORK/pgsql-vsix"
cp -R "$WORK/pgsql-vsix/extension" extensions/azuredatastudio-postgresql
echo "::endgroup::"

echo "::group::yarn install"
npm install -g yarn@1.22.22 >/dev/null 2>&1 || true
yarn install --network-timeout 300000
echo "::endgroup::"

echo "::group::compile"
yarn compile
cp src/vs/webPackagePaths.js out/vs/webPackagePaths.js
cp src/vs/code/browser/workbench/workbench-dev.html out/vs/code/browser/workbench/workbench-dev.html
echo "::endgroup::"

echo "::group::Server Node runtime ($NODE_DIST)"
NODE_RUNTIME_DIR=".build/node/v$ADS_NODE_VERSION/$PLATFORM-$ARCH"
mkdir -p "$NODE_RUNTIME_DIR"
if [[ "$PLATFORM" == "win32" ]]; then
  curl -sL -o "$WORK/node-dist.zip" "https://nodejs.org/dist/v$ADS_NODE_VERSION/node-v$ADS_NODE_VERSION-$NODE_DIST.zip"
  "$PYTHON_BIN" -c "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$WORK/node-dist.zip" "$WORK/node-dist"
  cp "$WORK/node-dist/node-v$ADS_NODE_VERSION-$NODE_DIST/node.exe" "$NODE_RUNTIME_DIR/node.exe"
else
  curl -sL "https://nodejs.org/dist/v$ADS_NODE_VERSION/node-v$ADS_NODE_VERSION-$NODE_DIST.tar.gz" | tar -xz -C "$WORK"
  cp "$WORK/node-v$ADS_NODE_VERSION-$NODE_DIST/bin/node" "$NODE_RUNTIME_DIR/node"
  chmod +x "$NODE_RUNTIME_DIR/node"
fi
echo "::endgroup::"

echo "::group::Stage + prune"
STAGE="$WORK/stage/ads"
mkdir -p "$STAGE/.build" "$STAGE/remote/web"
cp -R out node_modules extensions resources "$STAGE/"
cp product.json product.overrides.json package.json "$STAGE/"
cp -R .build/node "$STAGE/.build/"

# Per-extension production-only node_modules (the yarn installs include the
# whole dev toolchain). Failures keep the original tree.
export npm_config_audit=false npm_config_fund=false
for ext in "$STAGE"/extensions/*/; do
  ext="${ext%/}"
  [[ -f "$ext/package.json" && -d "$ext/node_modules" ]] || continue
  deps="$(node -e "console.log(Object.keys(require('$ext/package.json').dependencies ?? {}).length)")"
  if [[ "$deps" == "0" ]]; then
    rm -rf "$ext/node_modules"
  else
    mv "$ext/node_modules" "$ext/node_modules.orig"
    if (cd "$ext" && npm install --omit=dev --ignore-scripts --silent >/dev/null 2>&1); then
      rm -rf "$ext/node_modules.orig"
    else
      rm -rf "$ext/node_modules"
      mv "$ext/node_modules.orig" "$ext/node_modules"
    fi
  fi
done

# The web workbench loads jquery/slickgrid/angular/etc from remote/web/node_modules.
if [[ "$PLATFORM" == "win32" ]]; then
  # tar symlink extraction needs privileges on Windows; real copy + hardlink
  # dedupe below keeps the archive cost near zero.
  cp -R "$STAGE/node_modules" "$STAGE/remote/web/node_modules"
else
  ln -sfn ../../node_modules "$STAGE/remote/web/node_modules"
fi

# Hardlink-dedupe identical files so tar stores each payload once.
"$PYTHON_BIN" - "$STAGE" <<'PY'
import hashlib, os, sys
root = sys.argv[1]
seen = {}
for base in ("extensions", "node_modules", os.path.join("remote", "web", "node_modules")):
    top = os.path.join(root, base)
    if os.path.islink(top) or not os.path.isdir(top):
        continue
    for dirpath, _dirnames, filenames in os.walk(top):
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
                try:
                    os.link(seen[key], tmp)
                    os.replace(tmp, p)
                except OSError:
                    try:
                        os.remove(tmp)
                    except OSError:
                        pass
            else:
                seen.setdefault(key, p)
PY
echo "::endgroup::"

echo "::group::Smoke-boot the staged tree"
NODE_BIN="$STAGE/$NODE_RUNTIME_DIR/node"
[[ "$PLATFORM" == "win32" ]] && NODE_BIN="$STAGE/$NODE_RUNTIME_DIR/node.exe"
SMOKE_DATA="$WORK/smoke-data"
cd "$STAGE"
NODE_ENV=development VSCODE_DEV=1 "$NODE_BIN" out/server-main.js \
  --host 127.0.0.1 --port 41199 --without-connection-token --accept-server-license-terms \
  --telemetry-level off --server-data-dir "$SMOKE_DATA" --extensions-dir "$WORK/smoke-ext" \
  > "$WORK/smoke.log" 2>&1 < /dev/null &
SMOKE_PID=$!
cd "$WORK/ads"
ok=""
for _ in $(seq 1 30); do
  sleep 2
  if curl -sf -o /dev/null http://127.0.0.1:41199/; then ok=1; break; fi
done
if [[ -z "$ok" ]]; then
  echo "staged server never became ready" >&2
  cat "$WORK/smoke.log" >&2
  kill "$SMOKE_PID" 2>/dev/null || true
  exit 1
fi
curl -s http://127.0.0.1:41199/ | grep -q "workbench" || {
  echo "workbench html missing" >&2
  kill "$SMOKE_PID" 2>/dev/null || true
  exit 1
}
echo "staged server serves the workbench"
# Kill the smoke server (and any children) or the CI step waits on it forever.
kill "$SMOKE_PID" 2>/dev/null || true
echo "::endgroup::"

echo "::group::Archive"
tar -czf "$OUT" -C "$WORK/stage" ads
du -h "$OUT" | cut -f1
echo "::endgroup::"
