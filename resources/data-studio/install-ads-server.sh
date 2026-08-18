#!/usr/bin/env bash
# Build the REAL Azure Data Studio web server from Microsoft's source and
# install it where Orca's Data Studio tab expects it.
#
# NOTE: normal installs never run this — Orca downloads the prebuilt artifact
# from the project's GitHub release (see src/main/data-studio/ads-server-installer.ts,
# produced by package-ads-server.sh). This script is the from-source path for
# unsupported platforms and for producing new artifacts.
#
# Why build-from-source: microsoft/azuredatastudio is archived (retired
# Feb 28, 2026) and never shipped web-server binaries; its source also sits
# behind the Microsoft Source EULA, so Orca does not redistribute built
# artifacts. The repo still contains upstream VS Code's full server + web
# workbench (base: VS Code 1.82); ads-orca-web-server.patch repairs the small
# amount of web-build rot Microsoft left behind when they turned the web build
# off ("SQL CARBON EDIT: turn off web/remote build"):
#   - webClientServer.ts: alias bare /static/* URLs (ADS's retired web-server
#     paths, hardcoded in its workbench html) onto the static handler
#   - workbench-dev.html: load jquery/slickgrid/zone/reflect BEFORE the AMD
#     loader (their UMD wrappers crash it otherwise), drop the duplicate
#     loader include, and map moment/chartjs-adapter-moment AMD paths
#   - src/vs/webPackagePaths.js: restore the deleted web package map (content
#     from the built VS Code 1.82 web bundle)
#   - product.json: add version/date so extensions ("No valid VS Code version
#     detected") activate
#   - the html also gains a pre-boot script that seeds desktop-ADS
#     settings/keybindings (served by the patched /orca-import route) into the
#     web workbench's IndexedDB user data, only when absent
#
# Prereqs: git, Xcode CLT (macOS) / build-essential (Linux), Python 3,
# Node 20.16.0 (ADS's pinned .nvmrc version) available as $ORCA_ADS_NODE or on
# PATH, and yarn 1.x installed into that Node ("npm i -g yarn").
#
# Usage: install-ads-server.sh [--dest <dir>]
#   Default dest (macOS): ~/Library/Application Support/Orca/data-studio/ads
#   Default dest (Linux): ~/.config/Orca/data-studio/ads
set -euo pipefail

ADS_REPO="https://github.com/microsoft/azuredatastudio.git"
# Final archived main (ADS 1.53.0). The repo is read-only; this cannot drift.
ADS_COMMIT="38c5d45a3aed1015dc05ea9dd209c6433f1f3ed5"
ADS_NODE_VERSION="20.16.0"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_FILE="$SCRIPT_DIR/ads-orca-web-server.patch"

DEST=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest) DEST="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [[ -z "$DEST" ]]; then
  if [[ "$OSTYPE" == "darwin"* ]]; then
    DEST="$HOME/Library/Application Support/Orca/data-studio/ads"
  else
    DEST="$HOME/.config/Orca/data-studio/ads"
  fi
fi

NODE_BIN="${ORCA_ADS_NODE:-}"
if [[ -z "$NODE_BIN" ]]; then
  if [[ -x "$HOME/.nvm/versions/node/v$ADS_NODE_VERSION/bin/node" ]]; then
    NODE_BIN="$HOME/.nvm/versions/node/v$ADS_NODE_VERSION/bin/node"
  else
    NODE_BIN="$(command -v node)"
  fi
fi
ACTUAL_NODE_VERSION="$("$NODE_BIN" --version)"
if [[ "$ACTUAL_NODE_VERSION" != "v$ADS_NODE_VERSION" ]]; then
  echo "warning: building with Node $ACTUAL_NODE_VERSION (ADS pins v$ADS_NODE_VERSION); native module ABIs must match the runtime" >&2
fi
NODE_DIR="$(dirname "$NODE_BIN")"
export PATH="$NODE_DIR:$PATH"
if ! command -v yarn >/dev/null; then
  echo "yarn 1.x is required on the selected Node's PATH (npm i -g yarn)" >&2
  exit 2
fi

if [[ -e "$DEST/out/server-main.js" ]]; then
  echo "Already installed at $DEST (delete it to rebuild)"
  exit 0
fi

mkdir -p "$(dirname "$DEST")"
if [[ ! -d "$DEST/.git" ]]; then
  git clone --depth 1 "$ADS_REPO" "$DEST"
fi
cd "$DEST"
if [[ "$(git rev-parse HEAD)" != "$ADS_COMMIT" ]]; then
  git fetch --depth 1 origin "$ADS_COMMIT" && git checkout -q "$ADS_COMMIT"
fi

# admin-tool-ext-win (Windows-only SSMS helper) eagerly downloads SsmsMin from
# a decommissioned Azure blob (403) in its postinstall; neuter it.
node -e '
const fs = require("fs");
const p = "extensions/admin-tool-ext-win/package.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
if (j.scripts && j.scripts.postinstall) {
  j.scripts.postinstall = "node -e \"process.exit(0)\"";
  fs.writeFileSync(p, JSON.stringify(j, null, "\t") + "\n");
}
'

git apply --check "$PATCH_FILE" && git apply "$PATCH_FILE"

# The dev web server only forwards product fields the browser needs via
# product.overrides.json; vscodeVersion is what makes `vscode.version` valid in
# the remote extension host (extensions refuse to activate without it), and
# commit/quality must mirror product.json or the browser computes its
# remote-resource root as /oss-dev while the server serves /oss-<commit>,
# 404ing every theme/grammar/extension resource.
node -e '
const fs = require("fs");
const product = JSON.parse(fs.readFileSync("product.json", "utf8"));
fs.writeFileSync("product.overrides.json", JSON.stringify({
  version: "1.53.0",
  vscodeVersion: "1.82.0",
  date: "2026-08-17T00:00:00.000Z",
  commit: product.commit,
  quality: product.quality
}, null, "\t") + "\n");
'

# PostgreSQL support: Microsoft's official ADS extension, installed as a
# builtin (anything under extensions/ with a package.json is builtin in this
# serving mode). The platform vsix bundles pgsqltoolsservice — no runtime
# downloads from dead CDNs.
PGSQL_VERSION="0.6.0"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) PGSQL_ASSET="azuredatastudio-postgresql-$PGSQL_VERSION-osx-arm64.vsix" ;;
  Darwin-*) PGSQL_ASSET="azuredatastudio-postgresql-$PGSQL_VERSION-osx.vsix" ;;
  Linux-*) PGSQL_ASSET="azuredatastudio-postgresql-$PGSQL_VERSION-linux-x64.vsix" ;;
  *) PGSQL_ASSET="" ;;
esac
if [[ -n "$PGSQL_ASSET" && ! -d extensions/azuredatastudio-postgresql ]]; then
  curl -sL -o /tmp/orca-pgsql.vsix "https://github.com/microsoft/azuredatastudio-postgresql/releases/download/v$PGSQL_VERSION/$PGSQL_ASSET"
  unzip -q -o /tmp/orca-pgsql.vsix -d /tmp/orca-pgsql-vsix
  cp -R /tmp/orca-pgsql-vsix/extension extensions/azuredatastudio-postgresql
  rm -rf /tmp/orca-pgsql.vsix /tmp/orca-pgsql-vsix
fi

# ADS's web workbench loads jquery/slickgrid/angular from remote/web/node_modules;
# ADS deleted remote/ but ships all of those packages in the root node_modules.
mkdir -p remote/web
ln -sfn ../../node_modules remote/web/node_modules

yarn install --network-timeout 300000
yarn compile

# The server serves the workbench html + webPackagePaths from out/.
cp src/vs/webPackagePaths.js out/vs/webPackagePaths.js
cp src/vs/code/browser/workbench/workbench-dev.html out/vs/code/browser/workbench/workbench-dev.html

# The runtime must be a real Node matching the native-module ABI (never
# Electron-as-node); Orca resolves it under .build/node/<version>/<platform>.
PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)"
mkdir -p ".build/node/v$ADS_NODE_VERSION/$PLATFORM"
cp "$NODE_BIN" ".build/node/v$ADS_NODE_VERSION/$PLATFORM/node"
chmod +x ".build/node/v$ADS_NODE_VERSION/$PLATFORM/node"

echo "Azure Data Studio web server installed at: $DEST"
echo "Open a Data Studio tab in Orca to use it."
