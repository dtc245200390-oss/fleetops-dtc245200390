#!/bin/sh
set -eu
# Chỉ chạy khi tạo Postgres volume mới (initdb).
psql -X -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v appuser="$APP_DB_USER" -v apppass="$APP_DB_PASSWORD" \
  -v monuser="$MONITOR_DB_USER" -v monpass="$MONITOR_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE', :'appuser', :'apppass') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE', :'monuser', :'monpass') \gexec
GRANT pg_monitor TO :"monuser";
SQL
