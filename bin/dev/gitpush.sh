#!/usr/bin/env bash
# Run the commit+push prepared by an AI agent in /tmp/commit/script (message in /tmp/commit/message).
# The prepared script disarms itself after a successful run, so a second gitpush is a no-op.
[ -x /tmp/commit/script ] || { echo "gitpush: nothing prepared (/tmp/commit/script missing)" >&2; exit 1; }
exec /tmp/commit/script "$@"
