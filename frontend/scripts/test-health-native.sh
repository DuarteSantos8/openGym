#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
health_test_dir=$(mktemp -d)
trap 'rm -rf "$health_test_dir"' EXIT HUP INT TERM
swiftc ios/App/App/HealthWorkoutDeletion.swift ios/tests/health-workout-deletion/main.swift -o "$health_test_dir/health-deletion-tests"
"$health_test_dir/health-deletion-tests"
