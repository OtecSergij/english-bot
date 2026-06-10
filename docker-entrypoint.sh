#!/bin/sh
# Migrations first, fail-fast: the bot never starts against a stale schema.
set -e
node dist/migrate.js
# exec → node becomes PID 1 and receives SIGTERM directly (graceful shutdown).
exec node dist/index.js
