#!/bin/sh
# Takes the visitor's address from X-Forwarded-For when the connection comes from a proxy listed
# in REAL_IP_FROM (space-separated addresses or CIDRs). Without it, every request that reaches
# nginx through a reverse proxy on the same host (Tailscale Funnel, Caddy, Traefik, a Docker
# port mapping) arrives from the same address, the Docker gateway, and the API and MCP rate
# limits, which count per address, put every visitor in one bucket: one client's wrong passwords
# pause sign-in for all of them.
#
# Only the LAST X-Forwarded-For entry is used (real_ip_recursive off): the one the trusted proxy
# itself added. Whatever a client wrote further left is ignored. A request from any address not
# listed keeps its own address, so a client that reaches nginx directly cannot forge it.
#
# Empty (the default) writes nothing and nginx behaves exactly as before. The file goes in
# conf.d, which nginx includes at http level, so it applies to every location; it is rewritten
# on every start, so removing REAL_IP_FROM and restarting turns it off again.
set -eu

conf=/etc/nginx/conf.d/00-real-ip.conf
out=${REAL_IP_CONF:-$conf}
# A file mounted there by hand (the workaround before this script) cannot be removed: leave it.
rm -f "$out" 2>/dev/null || :
[ -n "${REAL_IP_FROM:-}" ] || exit 0

for entry in $REAL_IP_FROM; do
  case "$entry" in
    *[!0-9A-Fa-f.:/]*|*/|/*)
      echo "$0: REAL_IP_FROM entry \"$entry\" is not an IP address or CIDR. List the proxies nginx should trust, separated by spaces (REAL_IP_FROM=172.20.0.1), or leave it empty." >&2
      exit 1 ;;
  esac
done

{
  for entry in $REAL_IP_FROM; do
    echo "set_real_ip_from $entry;"
  done
  echo "real_ip_header X-Forwarded-For;"
  echo "real_ip_recursive off;"
} > "$out"
