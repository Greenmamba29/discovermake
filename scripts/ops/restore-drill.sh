#!/usr/bin/env bash
# Backup + restore drill (GA operations). Dumps SOURCE_URL with pg_dump (custom format),
# restores into a fresh scratch database on the same server, and compares exact row
# counts for every table. Exits non-zero on any mismatch. Never touches SOURCE_URL beyond
# a read-only dump; the scratch database name must end in _drill.
#
#   SOURCE_URL=postgresql://dm:dm@localhost:5432/discovermake scripts/ops/restore-drill.sh
set -euo pipefail
: "${SOURCE_URL:?set SOURCE_URL}"
DRILL_DB="${DRILL_DB:-discovermake_restore_drill}"
[[ "$DRILL_DB" == *_drill ]] || { echo "DRILL_DB must end in _drill" >&2; exit 2; }
ADMIN_URL="${SOURCE_URL%/*}/postgres"
DRILL_URL="${SOURCE_URL%/*}/${DRILL_DB}"
DUMP="$(mktemp -d)/backup.dump"

echo "[drill] dumping $(sed -E 's#//[^@]*@#//***@#' <<<"$SOURCE_URL")"
start=$(date +%s)
pg_dump --format=custom --no-owner --no-privileges --file="$DUMP" "$SOURCE_URL"
echo "[drill] dump size $(du -h "$DUMP" | cut -f1)"
psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS \"$DRILL_DB\" WITH (FORCE)" -c "CREATE DATABASE \"$DRILL_DB\""
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$DRILL_URL" "$DUMP"
echo "[drill] restored in $(( $(date +%s) - start ))s"

count_sql="select string_agg(format('%s=%s', t.table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', t.table_schema, t.table_name), false, true, '')))[1]::text), ',' order by t.table_name) from information_schema.tables t where t.table_schema='public' and t.table_type='BASE TABLE'"
src=$(psql "$SOURCE_URL" -Atc "$count_sql")
dst=$(psql "$DRILL_URL" -Atc "$count_sql")
psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS \"$DRILL_DB\" WITH (FORCE)"
rm -f "$DUMP"
if [[ "$src" == "$dst" ]]; then
  echo "[drill] PASS: $(tr ',' '\n' <<<"$src" | wc -l) tables, identical row counts"
else
  echo "[drill] FAIL: row counts differ" >&2
  diff <(tr ',' '\n' <<<"$src") <(tr ',' '\n' <<<"$dst") >&2 || true
  exit 1
fi
