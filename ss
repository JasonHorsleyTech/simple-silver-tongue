#!/bin/sh
# simple-silver CLI: a thin HTTP client over the server's command registry.
exec node "$(dirname "$0")/src/cli/main.ts" "$@"
