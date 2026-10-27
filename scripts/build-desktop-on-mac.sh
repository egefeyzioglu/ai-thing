#!/bin/bash
# Build an unsigned (ad-hoc signed) AI Thing .dmg on a Mac for a one-off demo.
#
# Usage, from any directory on the Mac:
#   bash build-desktop-on-mac.sh                 # clones the repo into ~/ai-thing
#   bash build-desktop-on-mac.sh /path/to/repo   # uses an existing checkout
#
# Without a checkout, fetch it first:
#   curl -fsSLO https://raw.githubusercontent.com/egefeyzioglu/ai-thing/main/scripts/build-desktop-on-mac.sh
#
# AITHING_BRANCH selects the branch to clone (default: main).
#
# Installs only what is missing: Xcode Command Line Tools (not Xcode),
# Node 24 via nvm, vite-plus (`vp`), and Rust via rustup. No Apple developer
# account is needed: unsigned builds get an ad-hoc signature, which is enough
# to launch on Apple Silicon but not to pass Gatekeeper on another Mac.
set -euo pipefail

REPO_URL="https://github.com/egefeyzioglu/ai-thing.git"
REPO_DIR="${1:-$HOME/ai-thing}"
REPO_BRANCH="${AITHING_BRANCH:-main}"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

# 1. Xcode Command Line Tools: clang, make, xcrun/iconutil, python3 for node-gyp.
if ! xcode-select -p >/dev/null 2>&1; then
  log "Installing Xcode Command Line Tools (a GUI dialog will appear; accept it)"
  xcode-select --install || true
  waited=0
  until xcode-select -p >/dev/null 2>&1; do
    if [ "$waited" -ge 1800 ]; then
      echo "Command Line Tools did not finish installing in 30 minutes. Rerun this script after installing them." >&2
      exit 1
    fi
    printf '   waiting for the Command Line Tools install to finish...\n'
    sleep 15
    waited=$((waited + 15))
  done
fi
for tool in clang make sips; do
  command -v "$tool" >/dev/null || { echo "missing $tool after CLT install" >&2; exit 1; }
done
xcrun --find iconutil >/dev/null

# 2. Node 24 (repo engines: ^24.13.1).
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then . "$NVM_DIR/nvm.sh"; fi
# Repo engines field: ^24.13.1.
node_ok() {
  local v
  v="$(node -v 2>/dev/null | sed -E 's/^v//')" || return 1
  [ -n "$v" ] || return 1
  [ "${v%%.*}" = "24" ] || return 1
  [ "$(printf '%s\n' "24.13.1" "$v" | sort -V | head -1)" = "24.13.1" ]
}
if ! node_ok; then
  log "Installing Node 24 via nvm"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | PROFILE=/dev/null bash
    . "$NVM_DIR/nvm.sh"
  fi
  nvm install 24
  nvm use 24
fi
node -v

# 3. vite-plus provides `vp` (the repo's task runner / package manager front end).
if ! command -v vp >/dev/null; then
  log "Installing vite-plus (vp)"
  npm install -g vite-plus@1.0.0
fi
vp --version

# 4. Rust for the resource-monitor helper. Host target is included by default.
if [ -s "$HOME/.cargo/env" ]; then . "$HOME/.cargo/env"; fi
if ! command -v cargo >/dev/null; then
  log "Installing Rust via rustup"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
  . "$HOME/.cargo/env"
fi
cargo --version

# 5. Source.
if ! git -C "$REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log "Cloning $REPO_URL ($REPO_BRANCH) into $REPO_DIR"
  git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$REPO_DIR"
fi
cd "$REPO_DIR"
REPO_DIR="$(pwd -P)"

# 6. Dependencies, scoped to what the desktop build needs (same filters as CI).
log "Installing dependencies"
vp install --filter=@t3tools/desktop... --filter=t3... --filter=@t3tools/scripts...
vp run --filter @t3tools/desktop ensure:electron

# 7. Build the DMG. T3CODE_DESKTOP_SIGNED=false keeps signing off even if the
#    environment enables it; the artifact script then ad-hoc signs the app.
case "$(uname -m)" in
  arm64) ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *) echo "unsupported arch $(uname -m)" >&2; exit 1 ;;
esac
log "Building AI Thing DMG for mac/$ARCH"
OUT_DIR="$REPO_DIR/release"
T3CODE_DESKTOP_SIGNED=false T3CODE_DESKTOP_SKIP_BUILD=false vp run dist:desktop:artifact --platform mac --target dmg --arch "$ARCH" --output-dir "$OUT_DIR" --verbose

log "Done. Artifacts:"
ls -la "$OUT_DIR"
cat <<'EOF'

Open the .dmg and drag "AI Thing" to Applications (the .zip holds the same
app). Built locally, it is not quarantined and opens on double click.
If you copy it to another Mac, clear the quarantine flag there once:
  xattr -dr com.apple.quarantine "/Applications/AI Thing.app"
EOF
