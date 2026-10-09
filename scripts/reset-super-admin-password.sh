#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
compose_file=${1:-"$script_dir/../docker-compose.yml"}
service=${2:-backend}
if [ "$#" -gt 2 ]; then
  echo "Usage: sh scripts/reset-super-admin-password.sh [compose-file] [service]" >&2
  exit 2
fi
printf 'Compose: %s; service: %s\n' "$compose_file" "$service"
exec docker compose --file "$compose_file" exec "$service" java \
  -Dloader.main=com.fengyi.ordershow.maintenance.ResetSuperAdminPassword \
  -cp /app/app.jar org.springframework.boot.loader.launch.PropertiesLauncher
