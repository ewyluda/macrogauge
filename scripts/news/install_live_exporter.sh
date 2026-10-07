#!/bin/bash
# Install (or reinstall) the live AI-infra news exporter on this Mac.
#
# Prereqs (Cloudflare dashboard, once):
#   1. R2 bucket for public site objects, e.g. `macrogauge-public`, with public
#      access on (r2.dev subdomain or a custom domain).
#   2. CORS on that bucket: GET from https://macrogauge.vercel.app,
#      https://macrogauge-cloudten.vercel.app and http://localhost:3123.
#   3. An R2 API token scoped to Object Read & Write on THAT bucket only
#      (not the kepler-caktus bucket — the exporter reads caktus through the
#      existing Kepler reader).
#
# This script stores the token in the Keychain, copies the exporter + config to
# ~/.local/share/macrogauge-news, loads a LaunchAgent that uploads every 5 min,
# then fetches the public URL once to prove the object is reachable. Re-run it
# after changing config/ai_news.json (universe, window) so the Mac copy matches.
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
readonly SHARE_DIR="${HOME}/.local/share/macrogauge-news"
readonly LOG_DIR="${HOME}/Library/Logs/Kepler"
readonly PLIST_PATH="${HOME}/Library/LaunchAgents/com.macrogauge.news-exporter.plist"
readonly DOMAIN="gui/$(id -u)"
readonly KEYCHAIN_ACCOUNT="${USER:-$(id -un)}"
readonly PREFIX="com.macrogauge.news-r2"

if [[ ! -x "${HOME}/.local/bin/kepler-caktus-litestream-reader" ]]; then
  echo "Kepler reader not installed — run notebook/scripts/setup_caktus_litestream_reader.sh first." >&2
  exit 1
fi

printf 'Public bucket name [macrogauge-public]: '
IFS= read -r bucket
bucket="${bucket:-macrogauge-public}"
if [[ ! "${bucket}" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]]; then
  echo "Not a valid R2 bucket name." >&2
  exit 1
fi

if /usr/bin/security find-generic-password -a "${KEYCHAIN_ACCOUNT}" -s "${PREFIX}.secret-access-key" >/dev/null 2>&1; then
  printf 'Credentials already in the Keychain. Replace them? [y/N]: '
  IFS= read -r replace
else
  replace=y
fi
if [[ "${replace}" =~ ^[Yy]$ ]]; then
  printf 'Cloudflare R2 account ID (not the access key): '
  IFS= read -r account_id
  if [[ ! "${account_id}" =~ ^[A-Za-z0-9]+$ ]]; then
    echo "The account ID must contain only letters and numbers." >&2
    exit 1
  fi
  printf 'Write-token Access Key ID (input hidden): '
  IFS= read -r -s access_key_id
  printf '\nWrite-token Secret Access Key (input hidden): '
  IFS= read -r -s secret_access_key
  printf '\n'
  if [[ -z "${access_key_id}" || -z "${secret_access_key}" ]]; then
    echo "Both credential values are required." >&2
    exit 1
  fi
  /usr/bin/security add-generic-password -U -a "${KEYCHAIN_ACCOUNT}" -s "${PREFIX}.account-id" -w "${account_id}" >/dev/null
  /usr/bin/security add-generic-password -U -a "${KEYCHAIN_ACCOUNT}" -s "${PREFIX}.access-key-id" -w "${access_key_id}" >/dev/null
  /usr/bin/security add-generic-password -U -a "${KEYCHAIN_ACCOUNT}" -s "${PREFIX}.secret-access-key" -w "${secret_access_key}" >/dev/null
  unset access_key_id secret_access_key
fi

printf 'Public URL of the object (e.g. https://pub-XXXX.r2.dev/ai-news.json): '
IFS= read -r public_url
if [[ ! "${public_url}" =~ ^https://.+/ai-news\.json$ ]]; then
  echo "Expected an https URL ending in /ai-news.json." >&2
  exit 1
fi

/bin/mkdir -p "${SHARE_DIR}" "${LOG_DIR}" "$(dirname "${PLIST_PATH}")"
/usr/bin/install -m 700 "${SCRIPT_DIR}/caktus_ai_news.py" "${SHARE_DIR}/caktus_ai_news.py"
/usr/bin/install -m 600 "${REPO_DIR}/config/ai_news.json" "${SHARE_DIR}/ai_news.json"
/usr/bin/sed "s/__BUCKET__/${bucket}/" "${SCRIPT_DIR}/com.macrogauge.news-exporter.plist" >"${PLIST_PATH}"
/bin/chmod 600 "${PLIST_PATH}"
/usr/bin/plutil -lint "${PLIST_PATH}"

echo "Running one export + upload now (up to ~2 min if it has to restore from R2)..."
/usr/bin/python3 "${SHARE_DIR}/caktus_ai_news.py" --config "${SHARE_DIR}/ai_news.json" \
  --upload --bucket "${bucket}"

echo "Checking the public object..."
headers="$(/usr/bin/curl -fsS -D - -o /dev/null -H 'Origin: https://macrogauge.vercel.app' "${public_url}")"
echo "${headers}" | /usr/bin/grep -i '^content-type:' || true
if ! echo "${headers}" | /usr/bin/grep -qi '^access-control-allow-origin:'; then
  echo "WARNING: no Access-Control-Allow-Origin header — add the CORS rule (step 2) or browsers will ignore the live feed." >&2
fi

/bin/launchctl bootout "${DOMAIN}" "${PLIST_PATH}" >/dev/null 2>&1 || true
/bin/launchctl bootstrap "${DOMAIN}" "${PLIST_PATH}"

echo
echo "Exporter installed: uploads r2://${bucket}/ai-news.json every 5 minutes."
echo "Log: ${LOG_DIR}/macrogauge-news-exporter.log"
echo "Last step: set \"live_url\": \"${public_url}\" in config/ai_news.json and commit,"
echo "so the daily run bakes it and the site starts polling it."
