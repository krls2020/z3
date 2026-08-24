#!/usr/bin/env bash
# Mint a fresh pairing credential on the zcp container and print how to connect.
# Requires: VPN up to the project, SSH alias `zcp`, and the local tunnel on 3888.
set -euo pipefail
LOCAL_PORT="${LOCAL_PORT:-3888}"

if ! nc -z 127.0.0.1 "$LOCAL_PORT" 2>/dev/null; then
  echo "Tunnel not up on $LOCAL_PORT — starting it."
  ssh -f -N -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ExitOnForwardFailure=yes -L "127.0.0.1:${LOCAL_PORT}:127.0.0.1:3773" zerops@zcp
  sleep 2
fi

CRED=$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null zerops@zcp 'cd /var/www && npx --yes t3@latest auth pairing create --base-dir "$HOME/.t3poc" --json 2>/dev/null' \
  | grep '"credential"' | cut -d'"' -f4)

echo
echo "  Host:          http://127.0.0.1:${LOCAL_PORT}"
echo "  Pairing code:  ${CRED}"
echo "  Browser URL:   http://127.0.0.1:${LOCAL_PORT}/pair#token=${CRED}"
echo
echo "  Valid ~5 minutes. Desktop app: Settings -> Connections -> add, paste host + code."
