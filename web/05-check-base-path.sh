#!/bin/sh
# Refuses to start on a BASE_PATH the nginx config cannot serve. The value is pasted into the
# location prefixes as-is: "/gym/" renders `location ^~ /gym//api/`, "gym" renders
# `location ^~ gym/api/`, and nginx matches neither, so the container came up and answered 404
# under the prefix with nothing in the log to say why. Empty (the default) serves the app at
# the site root.
#
# nginx's entrypoint runs /docker-entrypoint.d/*.sh in order and stops at the first that fails,
# so this one (05) runs before the template is rendered (20) and nginx never starts.
set -eu

case "${BASE_PATH:-}" in
  '') exit 0 ;;
  */) problem='ends with "/"' ;;
  /*) exit 0 ;;
  *) problem='does not start with "/"' ;;
esac
echo "$0: BASE_PATH=\"$BASE_PATH\" $problem. Set it to the prefix with one leading slash and no trailing one (BASE_PATH=/gym), or leave it empty to serve at the site root." >&2
exit 1
