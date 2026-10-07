#!/bin/sh
set -eu
frontend_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
watch_test_dir=$(mktemp -d)
trap 'rm -rf "$watch_test_dir"' EXIT
swiftc "$frontend_dir/ios/App/WatchApp/WatchOutbox.swift" "$frontend_dir/ios/tests/watch-outbox/main.swift" -o "$watch_test_dir/watch-outbox"
"$watch_test_dir/watch-outbox"
