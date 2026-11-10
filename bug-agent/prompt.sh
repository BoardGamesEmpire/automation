#!/usr/bin/env bash
# Prints the bug agent's prompt for one job: `triage` or `fix`. The shared
# instructions come from this directory; the calling repository's limits and
# notes come from the environment, as the reusable workflow sets them.
#
# Environment: GITHUB_REPOSITORY, ISSUE_NUMBER, PROTECTED_PATHS, TEST_PATHS,
# MODULE_PATTERN, MAX_LINES, REPO_NOTES.
set -euo pipefail

mode="$1"
here="$(cd "$(dirname "$0")" && pwd)"

list() { grep -v '^[[:space:]]*$' <<<"${1:-}" | sed 's/^[[:space:]]*/- `/; s/[[:space:]]*$/`/' || true; }

echo "Repository: ${GITHUB_REPOSITORY}"
echo "Issue number: ${ISSUE_NUMBER}"
echo
cat "$here/$mode.md"
echo
echo "## This repository's limits"
echo
echo "A fix may not change any of these paths:"
echo
list "$PROTECTED_PATHS"
echo
if grep -q '[^[:space:]]' <<<"${TEST_PATHS:-}"; then
  echo "A fix may change at most ${MAX_LINES} lines outside test files. Test files:"
  echo
  list "$TEST_PATHS"
else
  echo "A fix may change at most ${MAX_LINES} lines, tests included."
fi
if [ -n "${MODULE_PATTERN:-}" ]; then
  echo
  echo "A fix may change at most one module, where a path's module is the first"
  echo "group of this regular expression: \`${MODULE_PATTERN}\`."
fi
if [ -n "${REPO_NOTES:-}" ]; then
  echo
  echo "## Repository notes"
  echo
  printf '%s\n' "$REPO_NOTES"
fi
