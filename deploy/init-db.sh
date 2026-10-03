#!/bin/sh
set -eu
case "${APP_DATABASE_PASSWORD:?APP_DATABASE_PASSWORD is required}" in
  *[!a-f0-9]*|'') echo 'APP_DATABASE_PASSWORD must be a nonempty hexadecimal secret' >&2; exit 1 ;;
esac
psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 <<SQL
CREATE ROLE fighter_app LOGIN PASSWORD '$APP_DATABASE_PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE fighter_era OWNER fighter_app;
SQL
