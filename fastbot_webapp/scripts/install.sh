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
readonly PNPM_VERSION="$(node -p "require('./package.json').packageManager.split('@')[1]" 2>/dev/null || echo "")"

log()   { printf '\033[1;34m[install]\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m[install]\033[0m %s\n' "$*" >&2; }
fatal() { printf '\033[1;31m[install]\033[0m %s\n' "$*" >&2; exit 1; }

# ── locate webapp root (where package.json lives) ────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBAPP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
[[ -f "${WEBAPP_DIR}/package.json" ]] || fatal "package.json not found in ${WEBAPP_DIR}"

# ── 1. Node.js LTS via NodeSource ────────────────────────────────────────────
install_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p 'process.versions.node.split(".")[0]')"
    if (( major >= REQUIRED_NODE_MAJOR )); then
      log "Node $(node --version) already installed — skipping."
      return
    fi
    warn "Node $(node --version) is older than required v${REQUIRED_NODE_MAJOR} — upgrading."
  fi

  command -v apt-get >/dev/null 2>&1 \
    || fatal "Only apt-based distros (Ubuntu/Debian) are supported by this script. Install Node ${REQUIRED_NODE_MAJOR}+ manually then re-run."

  log "Installing Node.js LTS via NodeSource..."
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo apt-get install -y nodejs
  log "Installed $(node --version)"
}

# ── 2. pnpm via Corepack ─────────────────────────────────────────────────────
install_pnpm() {
  if ! command -v corepack >/dev/null 2>&1; then
    fatal "corepack not found — Node install must have failed."
  fi

  log "Enabling Corepack..."
  sudo corepack enable

  local target="${PNPM_VERSION:-latest}"
  log "Activating pnpm@${target}..."
  if [[ -n "${PNPM_VERSION}" ]]; then
    sudo corepack prepare "pnpm@${PNPM_VERSION}" --activate
  else
    sudo corepack prepare pnpm@latest --activate
  fi
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
