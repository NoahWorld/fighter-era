#!/bin/sh
set -eu
cd /opt/fighter-era/deploy
umask 077
mkdir -p /opt/fighter-era/backups
backup_file=/opt/fighter-era/backups/fighter-era-$(date -u +%Y%m%dT%H%M%SZ).dump
trap 'rm -f "$backup_file.partial"' EXIT HUP INT TERM
docker compose exec -T db pg_dump -U fighter_app -d fighter_era --format=custom > "$backup_file.partial"
test -s "$backup_file.partial"
mv "$backup_file.partial" "$backup_file"
find /opt/fighter-era/backups -maxdepth 1 -name 'fighter-era-*.dump' -type f -mtime +7 -delete
printf 'Database backup complete: %s\n' "$backup_file"
