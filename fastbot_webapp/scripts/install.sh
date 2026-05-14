#!/usr/bin/env bash
# Install Node.js LTS + pnpm on a Linux server, then install the webapp's
# dependencies. Mirrors what .devcontainer/devcontainer.json provisions.
#
# Usage:  ./scripts/install.sh
# Tested on Ubuntu 22.04 / 24.04 and Debian 12.
#
# Re-running is safe — each step checks what's already in place.

set -euo pipefail

readonly REQUIRED_NODE_MAJOR=20

log()   { printf '\033[1;34m[install]\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m[install]\033[0m %s\n' "$*" >&2; }
fatal() { printf '\033[1;31m[install]\033[0m %s\n' "$*" >&2; exit 1; }

# ── locate webapp root (where package.json lives) ────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBAPP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
[[ -f "${WEBAPP_DIR}/package.json" ]] || fatal "package.json not found in ${WEBAPP_DIR}"

# Read pnpm version from package.json — falls back to "latest" if Node isn't
# yet available (first run) or the file can't be parsed.
read_pnpm_version() {
  if command -v node >/dev/null 2>&1; then
    node -p "(require('${WEBAPP_DIR}/package.json').packageManager||'').split('@')[1] || ''" 2>/dev/null
  else
    grep -oP '"packageManager"\s*:\s*"pnpm@\K[^"]+' "${WEBAPP_DIR}/package.json" || true
  fi
}

# Major version of whichever node is currently first on PATH (or 0).
node_major() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

# ── 1. Node.js LTS via NodeSource ────────────────────────────────────────────
install_node() {
  local current
  current="$(node_major)"
  if (( current >= REQUIRED_NODE_MAJOR )); then
    log "Node $(node --version) already installed — skipping."
    return
  fi
  if (( current > 0 )); then
    warn "Existing node is v$(node --version 2>&1) — replacing with NodeSource LTS."
  fi

  command -v apt-get >/dev/null 2>&1 \
    || fatal "Only apt-based distros (Ubuntu/Debian) are supported by this script. Install Node ${REQUIRED_NODE_MAJOR}+ manually then re-run."

  log "Installing Node.js LTS via NodeSource..."
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo apt-get install -y nodejs

  # NodeSource installs to /usr/bin/node. Bash caches command paths, and
  # an older /usr/local/bin/node (if present) takes PATH priority — both
  # can leave us still resolving to the stale binary. Reset the cache,
  # then verify the active node is actually new enough.
  hash -r 2>/dev/null || true
  local active_path active_version active_major
  active_path="$(command -v node || echo '')"
  active_version="$(node --version 2>/dev/null || echo 'unknown')"
  active_major="$(node_major)"

  if (( active_major < REQUIRED_NODE_MAJOR )); then
    fatal "Installed NodeSource Node but 'node --version' still reports ${active_version} at ${active_path}.
A conflicting older Node is shadowing the new one. Remove it with one of:

  # If installed via apt 'nodejs' from the distro repo:
  sudo apt-get remove -y nodejs libnode-dev libnode72 libnode-* && sudo apt-get autoremove -y

  # If installed manually under /usr/local:
  sudo rm -f /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

Then re-run this script."
  fi

  log "Active node: ${active_version} (${active_path})"
}

# ── 2. pnpm via Corepack ─────────────────────────────────────────────────────
install_pnpm() {
  hash -r 2>/dev/null || true
  command -v corepack >/dev/null 2>&1 \
    || fatal "corepack not found — Node install must have failed."

  # Use sudo -E with the current PATH so sudo picks up the NodeSource
  # binaries at /usr/bin rather than an older corepack elsewhere.
  log "Enabling Corepack..."
  sudo -E env PATH="$PATH" corepack enable

  local pnpm_version
  pnpm_version="$(read_pnpm_version)"
  local target="${pnpm_version:-latest}"

  log "Activating pnpm@${target}..."
  sudo -E env PATH="$PATH" corepack prepare "pnpm@${target}" --activate

  hash -r 2>/dev/null || true
  log "Active pnpm: $(pnpm --version)"
}

# ── 3. Project dependencies ──────────────────────────────────────────────────
install_deps() {
  log "Installing webapp dependencies (pnpm install)..."
  cd "${WEBAPP_DIR}"
  pnpm install --frozen-lockfile
  log "Dependencies installed."
}

main() {
  install_node
  install_pnpm
  install_deps
  log "Done. Next steps:"
  log "  pnpm build      # produce dist/"
  log "  pnpm preview    # serve dist/ on http://0.0.0.0:7000"
}

main "$@"
