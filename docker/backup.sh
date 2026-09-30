#!/bin/sh
# Nightly pg_dump of the app database to R2 (S3 API), one gzip per day under backups/. Runs in the compose `backup` service.
# ponytail: no retention pruning; add an R2 lifecycle rule on backups/ to expire old dumps.
set -eu -o pipefail
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
while true; do
  key="backups/$(date +%F).sql.gz"
  if pg_dump "$DATABASE_URL" | gzip | aws s3 cp - "s3://$R2_BUCKET/$key" --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"; then
    echo "backup: wrote $key"
  else
    echo "backup: FAILED $key" >&2
  fi
  sleep 86400
done
