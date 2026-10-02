#!/usr/bin/env bash
# Render a HyperFrames composition on GitHub Actions instead of locally.
# Usage: scripts/render-video-on-github.sh <composition-dir> <output.mp4> [quality: draft|looks|delivery]
# Packs the directory, uploads it to the draft release "video-src" (collaborators only), runs video-render.yml,
# waits, and downloads the rendered MP4.
set -euo pipefail
DIR=${1:?composition dir}; OUT=${2:?output mp4}; Q=${3:-delivery}; TAG=video-src
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
tar -czf "$TMP/composition.tar.gz" -C "$DIR" --exclude=renders --exclude=node_modules --exclude=.debug .
gh release view "$TAG" > /dev/null 2>&1 || gh release create "$TAG" --draft --title "Video sources (private draft)" --notes "Composition uploads for video-render.yml. Draft: not public."
gh release upload "$TAG" "$TMP/composition.tar.gz" --clobber
before=$(gh run list --workflow video-render.yml -L 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || echo 0)
gh workflow run video-render.yml -f tag="$TAG" -f quality="$Q"
for _ in $(seq 60); do
  id=$(gh run list --workflow video-render.yml -L 1 --json databaseId -q '.[0].databaseId')
  [ "$id" != "$before" ] && break; sleep 5
done
echo "render run: $id"
gh run watch "$id" --exit-status > /dev/null || { gh run view "$id" --log-failed | tail -40; exit 1; }
gh run download "$id" -n video -D "$TMP/out"
mv "$TMP/out/brag.mp4" "$OUT"
echo "rendered → $OUT"
