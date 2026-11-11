#!/usr/bin/env bash
# Installs what the agent's subprocess isolation needs, for both agent jobs.
#
# run-agent.mjs sets CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, which keeps the API
# key out of the agent's commands by running them under bubblewrap. Claude
# Code refuses to start without bubblewrap and socat, and Ubuntu 24.04 blocks
# the unprivileged user namespaces bubblewrap needs. The same setup
# anthropics/claude-code-action does for untrusted senders.
#
# One script for both jobs, so they can't drift apart again: the fix job's
# copy of these steps once landed in triage, and no run caught it (#1).
#
# The apt mirrors fail often enough to cost runs: DNS errors resolving them
# ended three backend runs in one afternoon (#3). So the install is skipped
# when the runner already has both tools, and retried with a backoff when it
# doesn't.
set -euo pipefail

attempts=3

if command -v bwrap >/dev/null && command -v socat >/dev/null; then
  echo "bubblewrap and socat are already installed."
else
  for ((attempt = 1; ; attempt++)); do
    if sudo apt-get update -qq &&
      sudo apt-get install -y --no-install-recommends bubblewrap socat; then
      break
    fi
    if ((attempt == attempts)); then
      echo "::error::Installing bubblewrap and socat failed $attempts times."
      exit 1
    fi
    delay=$((attempt * 30))
    echo "::warning::Installing bubblewrap and socat failed (attempt $attempt of $attempts); retrying in ${delay}s."
    sleep "$delay"
  done
fi

if [ -f /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then
  sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
fi
