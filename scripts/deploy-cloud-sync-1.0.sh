#!/bin/sh
# Explicit maintenance deployment; running without --apply performs rehearsal only.
set -eu
umask 077
MODE=${1:---check}
SOURCE=${2:?usage: deploy-cloud-sync-1.0.sh --check|--apply candidate-repository-directory}
DB=${SYNC_DB:-/var/lib/cshell-sync/sync.sqlite}
DEST=${SYNC_CODE:-/opt/cshell-sync}
UNIT=${SYNC_UNIT:-cshell-sync}
case "$MODE" in --check|--apply) ;; *) exit 2;; esac
test -f "$SOURCE/services/cloud-sync/server.py"
test -f "$DB"
STAGE=$(mktemp -d /var/tmp/cshell-deploy-XXXXXXXX)
python3 "$SOURCE/scripts/cloud-sync-migration-check.py" --source-db "$DB" --output "$STAGE/rehearsal" --modules "$SOURCE/services/cloud-sync"
if [ "$MODE" = --check ]; then printf 'Rehearsal passed; private artifact: %s\n' "$STAGE"; exit 0; fi
# Backup before replacing code. Preserve environment/pepper/service identity separately;
# this script does not print or replace them and never grants membership or permission.
BACKUP="$DEST/backup-1.0-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$BACKUP"
cp "$DEST"/*.py "$BACKUP/"
systemctl stop "$UNIT"
python3 - "$DB" "$BACKUP/sync.sqlite" <<'PY'
import sqlite3,sys,os
with sqlite3.connect(sys.argv[1]) as source,sqlite3.connect(sys.argv[2]) as target:source.backup(target)
os.chmod(sys.argv[2],0o600)
PY
for module in "$SOURCE"/services/cloud-sync/*.py; do
 case "$(basename "$module")" in test_*) continue;; esac
 install -m 644 "$module" "$DEST/$(basename "$module")"
done
systemctl start "$UNIT"
sleep 2
if ! systemctl is-active --quiet "$UNIT"; then
 printf 'Startup failed. Service stopped; backup retained at %s. Do not restore DB over accepted writes.\n' "$BACKUP" >&2
 systemctl stop "$UNIT" || true
 exit 1
fi
python3 - <<'PY'
import urllib.request,json
with urllib.request.urlopen('http://127.0.0.1:8789/v1/health',timeout=10) as r:
 assert r.status==200
 json.load(r)
print('Health passed; continue authenticated bridge/chunk/feedback acceptance before exposing new clients.')
PY
printf 'Backup: %s\n' "$BACKUP"
# No automatic database rollback: once chunks, metering, journal or DNS writes exist,
# old code must not run against this DB. Use a corrected forward build. Restore a DB
# only in maintenance after explicitly reconciling all writes since this backup.
