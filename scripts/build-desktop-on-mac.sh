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
# account is needed: electron-builder ad-hoc signs the app on Apple Silicon.
set -euo pipefail

REPO_URL="https://github.com/egefeyzioglu/ai-thing.git"
REPO_DIR="${1:-$HOME/ai-thing}"
REPO_BRANCH="${AITHING_BRANCH:-main}"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

# 1. Xcode Command Line Tools: clang, make, xcrun/iconutil, python3 for node-gyp.
if ! xcode-select -p >/dev/null 2>&1; then
  log "Installing Xcode Command Line Tools (a GUI dialog will appear; accept it)"
  xcode-select --install || true
  until xcode-select -p >/dev/null 2>&1; do
    printf '   waiting for the Command Line Tools install to finish...\n'
    sleep 15
  done
fi
for tool in clang make sips; do
  command -v "$tool" >/dev/null || { echo "missing $tool after CLT install" >&2; exit 1; }
done
xcrun --find iconutil >/dev/null

# 2. Node 24 (repo engines: ^24.13.1).
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then . "$NVM_DIR/nvm.sh"; fi
node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'; }
if [ "$(node_major)" != "24" ]; then
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
if [ ! -d "$REPO_DIR/.git" ]; then
  log "Cloning $REPO_URL ($REPO_BRANCH) into $REPO_DIR"
  git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$REPO_DIR"
fi
cd "$REPO_DIR"

# 6. Dependencies, scoped to what the desktop build needs (same filters as CI).
log "Installing dependencies"
vp install --filter=@t3tools/desktop... --filter=t3... --filter=@t3tools/scripts...
vp run --filter @t3tools/desktop ensure:electron

# 7. Build the DMG. Unsigned by default: CSC_IDENTITY_AUTO_DISCOVERY is forced
#    off by the script and electron-builder falls back to an ad-hoc signature.
case "$(uname -m)" in
  arm64) ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *) echo "unsupported arch $(uname -m)" >&2; exit 1 ;;
esac
log "Building AI Thing DMG for mac/$ARCH"
vp run dist:desktop:artifact --platform mac --target dmg --arch "$ARCH" --verbose

log "Done. Artifacts:"
ls -la "$REPO_DIR/release"/*.dmg "$REPO_DIR/release"/mac*/*.app 2>/dev/null || ls -la "$REPO_DIR/release"
cat <<'EOF'

Open the .dmg and drag "AI Thing" to Applications, or run the .app directly
from release/. It was built locally, so Gatekeeper will not quarantine it.
If you copy the .dmg to another Mac, run this once there:
  xattr -dr com.apple.quarantine "/Applications/AI Thing.app"
EOF
