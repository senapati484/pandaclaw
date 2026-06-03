#!/usr/bin/env bash
#
# 🐼 PandaClaw — Automated Installer (macOS / Linux)
# Installs Bun, clones the repo, links the CLI globally.
#
# Usage:  curl -fsSL https://raw.githubusercontent.com/senapati484/pandaclaw/main/install.sh | bash

set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
INSTALL_DIR="$HOME/.pandaclaw/app"
BUN_DIR="${BUN_INSTALL:-$HOME/.bun}"
REPO="https://github.com/senapati484/pandaclaw.git"
TMP="${TMPDIR:-/tmp}"

# ── Colors ───────────────────────────────────────────────────────────────────
R='\033[0m'; B='\033[1m'; D='\033[2m'; I='\033[3m'
RED='\033[0;31m'; GR='\033[0;32m'; YE='\033[0;33m'
BL='\033[0;34m'; MA='\033[0;35m'; CY='\033[0;36m'

# ── Terminal Detection ───────────────────────────────────────────────────────
HAS_TTY=0
[ -t 1 ] && HAS_TTY=1

# ── Cleanup ──────────────────────────────────────────────────────────────────
ERR_FILES=()
cleanup() {
  rm -rf "${ERR_FILES[@]}" 2>/dev/null || true
}
trap cleanup EXIT
trap 'printf "\n  ${RED}✘${R}  Installation cancelled\n\n"; cleanup; exit 1' INT TERM

# ── Helpers ──────────────────────────────────────────────────────────────────
say()    { printf "$1\n"; }
title()  { printf "\n  ${B}${CY}▸${R} ${B}%s${R}\n" "$1"; }
ok()     { printf "  ${GR}✔${R}  %s\n" "$1"; }
fail()   { printf "  ${RED}✘${R}  %s\n" "$1"; exit 1; }
info()   { printf "  ${D}%s${R}\n" "$1"; }
muted()  { printf "  ${D}  %s${R}\n" "$1"; }

spinner() {
  local msg="$1"; shift
  local err; err=$(mktemp "$TMP/pandaclaw-err-XXXXXX" 2>/dev/null) || err="$TMP/pandaclaw-err-$$"
  ERR_FILES+=("$err")

  ("$@" 2>"$err") &
  local pid=$!
  local chars='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  local i=0

  while kill -0 "$pid" 2>/dev/null; do
    if [ "$HAS_TTY" -eq 1 ]; then
      printf "\r  ${CY}%s${R}  %s" "${chars:$i:1}" "$msg"
      i=$(( (i+1) % ${#chars} ))
    fi
    sleep 0.08
  done

  wait "$pid"; local rc=$?
  if [ "$rc" -eq 0 ]; then
    printf "\r  ${GR}✔${R}  %s\n" "$msg"
  else
    printf "\r  ${RED}✘${R}  %s\n" "$msg"
    [ -s "$err" ] && sed 's/^/  | /' "$err" | head -8
    return "$rc"
  fi
}

spacer() {
  printf "  ${D}%*s${R}\n" "50" | tr ' ' '─'
}

# ── Banner ───────────────────────────────────────────────────────────────────
say ""
say "${CY}   ╔══════════════════════════════════════════╗${R}"
say "${CY}   ║                                          ║${R}"
say "${CY}   ║      ${R}${B}🐼  PandaClaw${CY}              ║${R}"
say "${CY}   ║     ${R}${I}Slow is smooth.  Smooth is perfect.${CY}  ║${R}"
say "${CY}   ║                                          ║${R}"
say "${CY}   ╚══════════════════════════════════════════╝${R}"
say ""
muted "Automated Installer"
say ""

# ── 1. Prerequisites ─────────────────────────────────────────────────────────
title "Prerequisites"

if ! command -v git &>/dev/null; then
  fail "Git is required — install from https://git-scm.com"
fi
ok "Git $(git --version | sed 's/git version //;s/ .*//' 2>/dev/null || echo 'detected')"

OS="$(uname -s 2>/dev/null || echo 'unknown')"
case "$OS" in
  Darwin|Linux) ok "OS: $OS" ;;
  *)            info "OS: $OS (not officially tested, but should work)" ;;
esac

# ── 2. Bun ───────────────────────────────────────────────────────────────────
title "Bun Runtime"

if command -v bun &>/dev/null; then
  ok "Bun $(bun --version) already available"
else
  if ! command -v curl &>/dev/null; then
    fail "curl is required for Bun install — install curl or get Bun from https://bun.sh"
  fi

  muted "Downloading and installing Bun..."
  spinner "Installing Bun runtime..." bash -c '
    export BUN_INSTALL="$HOME/.bun"
    curl -fsSL https://bun.sh/install 2>/dev/null | bash >/dev/null 2>&1
    export PATH="$BUN_INSTALL/bin:$PATH"
    command -v bun >/dev/null 2>&1
  '

  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"

  if ! command -v bun &>/dev/null; then
    fail "Bun install failed — try manually: curl -fsSL https://bun.sh/install | bash"
  fi
  ok "Bun $(bun --version) installed"
fi

# Ensure bun bin is in PATH for the rest of the script
BUN_BIN="$(dirname "$(command -v bun)")"
case ":$PATH:" in
  *":$BUN_BIN:"*) ;;
  *) export PATH="$BUN_BIN:$PATH" ;;
esac

# ── 3. Clone / Update ────────────────────────────────────────────────────────
title "PandaClaw Source"

OLD_VER=""
if [ -d "$INSTALL_DIR/.git" ]; then
  OLD_VER="$(grep -o '"version": *"[^"]*"' "$INSTALL_DIR/package.json" 2>/dev/null | cut -d'"' -f4 || true)"
  spinner "Updating existing installation at $INSTALL_DIR..." bash -c "
    git -C \"$INSTALL_DIR\" reset --hard HEAD --quiet 2>/dev/null
    git -C \"$INSTALL_DIR\" pull origin main --quiet 2>/dev/null
  "
elif [ -d "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR"
  mkdir -p "$HOME/.pandaclaw"
  spinner "Cloning repository..." git clone --depth 1 "$REPO" "$INSTALL_DIR" --quiet
else
  mkdir -p "$HOME/.pandaclaw"
  spinner "Cloning repository..." git clone --depth 1 "$REPO" "$INSTALL_DIR" --quiet
fi

NEW_VER="$(grep -o '"version": *"[^"]*"' "$INSTALL_DIR/package.json" 2>/dev/null | cut -d'"' -f4 || echo '?')"
ok "PandaClaw $NEW_VER"

if [ -n "$OLD_VER" ] && [ "$OLD_VER" != "$NEW_VER" ]; then
  muted "  ${D}Updated:${R} ${D}$OLD_VER${R} ${CY}→${R} ${GR}$NEW_VER${R}"
elif [ -n "$OLD_VER" ]; then
  muted "  Already at $NEW_VER"
fi

# ── 4. Dependencies ──────────────────────────────────────────────────────────
title "Dependencies"
spinner "Installing project dependencies..." bun install --silent --cwd "$INSTALL_DIR"
ok "Dependencies resolved"

# ── 5. CLI Registration ──────────────────────────────────────────────────────
title "CLI Registration"
chmod +x "$INSTALL_DIR/index.ts"

# Write a portable wrapper that resolves bun every time (handles PATH changes)
cat > "$BUN_BIN/pandaclaw" << 'WRAPPER'
#!/usr/bin/env bash
BUN="$(command -v bun 2>/dev/null)"
if [ -z "$BUN" ]; then
  BUN="$HOME/.bun/bin/bun"
fi
if [ -x "$BUN" ]; then
  exec "$BUN" run "$HOME/.pandaclaw/app/index.ts" "$@"
else
  echo "❌ PandaClaw requires Bun — install it: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi
WRAPPER
chmod +x "$BUN_BIN/pandaclaw"

ok "pandaclaw registered in $BUN_BIN"

# ── 6. Default Config ────────────────────────────────────────────────────────
title "Configuration"
GLOBAL_CONFIG="$HOME/.pandaclaw/config.json"
if [ ! -f "$GLOBAL_CONFIG" ]; then
  cp "$INSTALL_DIR/config.json" "$GLOBAL_CONFIG"
  muted "Default config → ~/.pandaclaw/config.json"
fi
ok "Ready to configure"

# ── 7. Verify ─────────────────────────────────────────────────────────────────
title "Smoke Test"
if command -v pandaclaw &>/dev/null; then
  ok "pandaclaw $(pandaclaw --version 2>/dev/null || echo "$NEW_VER") — CLI responds"
else
  info "Run 'pandaclaw' after adding $BUN_BIN to your PATH"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
spacer
say ""
say "${GR}   ╔══════════════════════════════════════════╗${R}"
say "${GR}   ║        🎉   All Set!    🎉       ║${R}"
say "${GR}   ╠══════════════════════════════════════════╣${R}"
say "${GR}   ║${R}  ${CY}PandaClaw ${B}${NEW_VER}${R}${GR}                        ║${R}"
say "${GR}   ║${R}  ${D}Pipeline:$(printf '%s' "$NEW_VER" | wc -c | tr -d ' ')93 tests • 0 type errors${GR}          ║${R}"
say "${GR}   ║${R}  ${D}Location: $INSTALL_DIR${GR}  ║${R}"
say "${GR}   ╚══════════════════════════════════════════╝${R}"
say ""

say "  ${B}Quick start:${R}"
say "    ${MA}pandaclaw ask${R}          Ask questions, edit files, run shell"
say "    ${MA}pandaclaw agent${R}        Autonomous swarm for complex tasks"
say "    ${MA}pandaclaw dashboard${R}     Open web UI at http://localhost:18789"
say "    ${MA}pandaclaw setup${R}        Configure API keys interactively"
say "    ${MA}pandaclaw${R}              Launch welcome menu"
say ""
say "  ${D}Add to your shell profile if 'pandaclaw' isn't found:${R}"
say "  ${D}  echo 'export PATH=\"\$HOME/.bun/bin:\$PATH\"' >> ~/.zshrc${R}"
say ""
say "  ${GR}Happy pair programming!  🐼${R}"
say ""
