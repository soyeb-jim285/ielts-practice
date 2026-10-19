#!/bin/sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! docker info >/dev/null 2>&1; then
  printf '%s\n' 'Install/start Docker Desktop (or Docker Engine), then try again.' >&2
  exit 1
fi
docker compose version >/dev/null
docker run --rm --user "$(id -u):$(id -g)" --mount "type=bind,source=$DIR,target=/bundle" node:24-alpine node /bundle/setup.mjs
docker compose --project-directory "$DIR" -f "$DIR/compose.yml" up -d --wait --wait-timeout 300
docker compose --project-directory "$DIR" -f "$DIR/compose.yml" exec -T app node --import tsx /demo/initialize.mjs
printf '\n%s\n' 'Ready: http://localhost:8787' "Sign-in details: $DIR/demo-login.txt" 'Stop with: docker compose down (from this folder; recordings are preserved).'
