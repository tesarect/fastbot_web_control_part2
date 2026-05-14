#!/usr/bin/env bash
# Install Node.js LTS + pnpm on a Linux server, then install the webapp's
# dependencies. Mirrors what .devcontainer/devcontainer.json provisions.
#
# Strategy:
#   - If nvm is present, upgrade Node through nvm so we don't fight a
#     pre-existing nvm-managed binary that's first on PATH.
#   - Otherwise install Node LTS via NodeSource apt repo.
#   - Activate pnpm via Corepack at the version pinned in package.json.
#   - Invoke corepack/pnpm by absolute path from the new node's bin dir so
#     stale shims on PATH (e.g. /usr/local/bin/pnpm from earlier broken
#     installs) can't shadow the working binary.
#
# Usage:  ./scripts/install.sh
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

# Set by install_node — used by every subsequent step.
NODE_BIN_DIR=""
USED_NVM=false

# ── helpers ──────────────────────────────────────────────────────────────────
read_pnpm_version() {
  local node_bin="${NODE_BIN_DIR:-}/node"
  if [[ -x "$node_bin" ]]; then
    "$node_bin" -p "(require('${WEBAPP_DIR}/package.json').packageManager||'').split('@')[1] || ''" 2>/dev/null
  else
    grep -oP '"packageManager"\s*:\s*"pnpm@\K[^"]+' "${WEBAPP_DIR}/package.json" || true
  fi
}

node_major() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

detect_nvm() {
  local candidates=(
    "${NVM_DIR:-}"
    "${HOME}/.nvm"
    "/usr/local/nvm"
    "/usr/local/share/nvm"
    "/usr/local/share/shell/.nvm"
    "/opt/nvm"
  )
  for d in "${candidates[@]}"; do
    [[ -n "$d" && -s "$d/nvm.sh" ]] && { echo "$d"; return; }
  done
  echo ""
}

load_nvm() {
  local nvm_dir="$1"
  export NVM_DIR="$nvm_dir"
  set +u
  # shellcheck disable=SC1090
  . "${nvm_dir}/nvm.sh"
  set -u
}

# ── 1. Node.js LTS ───────────────────────────────────────────────────────────
install_node_via_nvm() {
  local nvm_dir="$1"
  log "nvm detected at ${nvm_dir} — installing Node LTS through nvm..."
  load_nvm "$nvm_dir"

  nvm install --lts
  nvm use --lts
  nvm alias default 'lts/*' >/dev/null
  USED_NVM=true

  NODE_BIN_DIR="$(dirname "$(nvm which current)")"
  log "Active node: $("${NODE_BIN_DIR}/node" --version) (${NODE_BIN_DIR}/node)"
  warn "Open a NEW shell (or run 'nvm use --lts') so future logins pick up the LTS default."
}

install_node_via_apt() {
  command -v apt-get >/dev/null 2>&1 \
    || fatal "No nvm found and apt-get unavailable. Install Node ${REQUIRED_NODE_MAJOR}+ manually then re-run."

  log "Installing Node.js LTS via NodeSource..."
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo apt-get install -y nodejs

  # NodeSource installs node to /usr/bin/node. We pin to that absolute
  # path rather than trusting PATH lookup, in case an older /usr/local
  # binary still shadows it.
  NODE_BIN_DIR="/usr/bin"
  local v
  v="$("${NODE_BIN_DIR}/node" --version 2>/dev/null || echo 'missing')"
  [[ "$v" =~ ^v([0-9]+) ]] && (( BASH_REMATCH[1] >= REQUIRED_NODE_MAJOR )) \
    || fatal "NodeSource install reports ${v} at ${NODE_BIN_DIR}/node — expected v${REQUIRED_NODE_MAJOR}+."
  log "Active node: ${v} (${NODE_BIN_DIR}/node)"
}

install_node() {
  local current
  current="$(node_major)"
  if (( current >= REQUIRED_NODE_MAJOR )); then
    NODE_BIN_DIR="$(dirname "$(command -v node)")"
    log "Node $(node --version) already installed at ${NODE_BIN_DIR}/node — skipping."
    return
  fi
  if (( current > 0 )); then
    warn "Current node is $(node --version) — upgrading."
  fi

  local nvm_dir
  nvm_dir="$(detect_nvm)"
  if [[ -n "$nvm_dir" ]]; then
    install_node_via_nvm "$nvm_dir"
  else
    install_node_via_apt
  fi
}

# ── 2. pnpm via Corepack ─────────────────────────────────────────────────────
install_pnpm() {
  local corepack_bin="${NODE_BIN_DIR}/corepack"
  local pnpm_bin="${NODE_BIN_DIR}/pnpm"
  [[ -x "$corepack_bin" ]] || fatal "corepack not found at ${corepack_bin}"

  local pnpm_version
  pnpm_version="$(read_pnpm_version)"
  local target="${pnpm_version:-latest}"

  # Only the NodeSource path lives under root-owned /usr/bin.
  local maybe_sudo=()
  if [[ "$USED_NVM" != "true" ]]; then
    maybe_sudo=(sudo -E env "PATH=$PATH")
  fi

  log "Enabling Corepack..."
  "${maybe_sudo[@]}" "$corepack_bin" enable

  log "Activating pnpm@${target}..."
  "${maybe_sudo[@]}" "$corepack_bin" prepare "pnpm@${target}" --activate

  [[ -x "$pnpm_bin" ]] || fatal "corepack didn't create ${pnpm_bin}. Try: ${corepack_bin} enable --install-directory ${NODE_BIN_DIR}"
  log "Active pnpm: $("$pnpm_bin" --version) (${pnpm_bin})"
}

# ── 3. Project dependencies ──────────────────────────────────────────────────
install_deps() {
  local pnpm_bin="${NODE_BIN_DIR}/pnpm"
  log "Installing webapp dependencies (pnpm install)..."
  cd "${WEBAPP_DIR}"
  "$pnpm_bin" install --frozen-lockfile
  log "Dependencies installed."
}

main() {
  install_node
  install_pnpm
  install_deps
  log "Done. Next steps:"
  log "  ${NODE_BIN_DIR}/pnpm build      # produce dist/"
  log "  ${NODE_BIN_DIR}/pnpm preview    # serve dist/ on http://0.0.0.0:7000"
  if [[ "$USED_NVM" == "true" ]]; then
    log "Tip: open a new shell so 'node', 'pnpm' on your interactive PATH point at the new install."
  fi
}

main "$@"
