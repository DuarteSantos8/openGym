#!/bin/sh
# Adds `listen [::]:NGINX_PORT` next to the IPv4 one in the rendered config. The base image's
# own 10-listen-on-ipv6-by-default.sh does this for default.conf, but the template is rendered
# after it (20) and overwrites that file, so nginx listened on IPv4 only. On a dual-stack
# Kubernetes Service, every connection to the pod's IPv6 address was refused and the proxy in
# front answered every other request with a 503.
#
# Skipped where the kernel has no IPv6 (no /proc/net/if_inet6), the same test the base image
# uses, so such a host still starts. Runs after the template (20), before nginx starts.
set -eu

conf=/etc/nginx/conf.d/default.conf

if [ ! -f /proc/net/if_inet6 ]; then
  echo "$0: no IPv6 in this container, nginx listens on IPv4 only"
  exit 0
fi
if grep -q 'listen[[:space:]]*\[::\]' "$conf"; then
  exit 0
fi
sed -i "s/^\([[:space:]]*\)listen ${NGINX_PORT};/&\n\1listen [::]:${NGINX_PORT};/" "$conf"
echo "$0: nginx listens on [::]:${NGINX_PORT} too"
