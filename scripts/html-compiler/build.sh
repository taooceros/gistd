#!/usr/bin/env bash
# Builds the HTML-capable typst.ts web compiler used by ?g-output=html and
# packs it as an npm tarball. This is typst.ts with html-export.patch applied,
# which adds TypstCompileWorld.html().
#
# The tarball is hosted as a GitHub release asset, not committed, and
# package.json depends on the release URL. To publish a rebuild:
#   scripts/html-compiler/build.sh --release
# then update the URL in package.json and run `pnpm install`.
#
# Needs: git, rustup (typst.ts toolchain + wasm32-unknown-unknown), wasm-pack,
# node/npm; gh for --release.
set -euo pipefail

TYPST_TS_REF="${TYPST_TS_REF:-v0.8.0-rc1}"
REPO="${REPO:-taooceros/gistd}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK:-$(mktemp -d)}"
OUT="${OUT:-$WORK/out}"

git clone --filter=blob:none --branch "$TYPST_TS_REF" \
  https://github.com/Myriad-Dreamin/typst.ts "$WORK/typst.ts"
cd "$WORK/typst.ts"
git apply "$HERE/html-export.patch"
rustup target add wasm32-unknown-unknown

cd packages/compiler
wasm-pack build --target web --scope myriaddreamin -- \
  --no-default-features --features web,misc,html
node ../tools/wasm-debundle.mjs

PKG="$WORK/package"
mkdir -p "$PKG/pkg" "$OUT"
cp "$HERE/package.json" "$PKG/"
cp pkg/wasm-pack-shim.mjs pkg/typst_ts_web_compiler.mjs \
  pkg/typst_ts_web_compiler.d.ts pkg/typst_ts_web_compiler_bg.wasm \
  pkg/typst_ts_web_compiler_bg.wasm.d.ts "$PKG/pkg/"
TARBALL="$OUT/$(cd "$PKG" && npm pack --silent --pack-destination "$OUT")"
echo "Packed $TARBALL"

if [[ "${1:-}" == "--release" ]]; then
  VERSION="$(node -p "require('$PKG/package.json').version")"
  TAG="html-compiler-$VERSION"
  gh release create "$TAG" "$TARBALL" --repo "$REPO" --latest=false \
    --title "HTML-capable typst.ts web compiler $VERSION" \
    --notes "typst.ts $TYPST_TS_REF + scripts/html-compiler/html-export.patch, used by gistd ?g-output=html."
  echo "https://github.com/$REPO/releases/download/$TAG/$(basename "$TARBALL")"
fi
