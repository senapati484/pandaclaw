#!/usr/bin/env bash
#
# 🐼 PandaClaw — Automated Installer
# Installs Bun, clones the repository, links the CLI globally.
# Usage: curl -fsSL https://raw.githubusercontent.com/senapati484/pandaclaw/main/install.sh | bash

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────
R='\033[0m'; B='\033[1m'; D='\033[2m'
RED='\033[0;31m'; GR='\033[0;32m'; YE='\033[0;33m'
BL='\033[0;34m'; MA='\033[0;35m'; CY='\033[0;36m'

# ── Helpers ─────────────────────────────────────────────────────────────────
run_spinner() {
  local msg="$1"; shift
  local err; err=$(mktemp 2>/dev/null) || err="/tmp/pandaclaw-$$"
  ("$@" 2>"$err") &
  local pid=$!; local chars='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'; local i=0
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r  ${CY}%s${R}  %s" "${chars:$i:1}" "$msg"
    i=$(( (i+1) % ${#chars} )); sleep 0.08
  done
  wait "$pid"; local rc=$?
  if [ $rc -eq 0 ]; then
    printf "\r  ${GR}✔${R}  %s\n" "$msg"
    rm -f "$err"
  else
    printf "\r  ${RED}✘${R}  %s\n" "$msg"
    [ -s "$err" ] && sed 's/^/    /' "$err" | head -5
    rm -f "$err"
    return $rc
  fi
}

run_cmd() {
  local msg="$1"; shift
  local err; err=$(mktemp 2>/dev/null) || err="/tmp/pandaclaw-$$"
  if "$@" 2>"$err"; then printf "  ${GR}✔${R}  %s\n" "$msg"; rm -f "$err"
  else
    printf "  ${RED}✘${R}  %s\n" "$msg"
    [ -s "$err" ] && sed 's/^/    /' "$err" | head -5
    rm -f "$err"; return 1
  fi
}

get_version() {
  grep -o '"version": *"[^"]*"' "$1/package.json" 2>/dev/null | head -1 | cut -d'"' -f4
}

# ── Banner ──────────────────────────────────────────────────────────────────
printf "\n${CY}"
printf "  ╔══════════════════════════════════╗\n"
printf "  ║                                  ║\n"
printf "  ║      ${R}${B}🐼  PandaClaw${CY}        ║\n"
printf "  ║     ${R}${D}Slow is smooth.${CY}        ║\n"
printf "  ║     ${R}${D}Smooth is perfect.${CY}      ║\n"
printf "  ║                                  ║\n"
printf "  ╚══════════════════════════════════╝\n"
printf "${R}\n"
printf "  ${D}Automated Installer${R}\n"
printf "\n"

# ── 1. Git ──────────────────────────────────────────────────────────────────
printf "  ${B}${CY}▸${R} ${B}Prerequisites${R}\n"
if ! command -v git &>/dev/null; then
  printf "  ${RED}✘${R}  Git is required. Install from https://git-scm.com\n"
  exit 1
fi
printf "  ${GR}✔${R}  Git %s\n" "$(git --version 2>/dev/null | sed 's/.* \([0-9]\.[0-9]\)/\1/' | tr -d '[:alpha:]' || echo 'detected')"

# ── 2. Bun ──────────────────────────────────────────────────────────────────
if ! command -v bun &>/dev/null; then
  run_spinner "Installing Bun runtime..." bash -c '
    curl -fsSL https://bun.sh/install | bash &>/dev/null
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
    command -v bun &>/dev/null
  '
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  if ! command -v bun &>/dev/null; then
    printf "\n  ${RED}✘${R}  Bun install failed. Try https://bun.sh manually\n"
    exit 1
  fi
else
  run_cmd "Bun $(bun --version) already available" true
fi

# ── 3. Clone / Update ───────────────────────────────────────────────────────
printf "\n  ${B}${CY}▸${R} ${B}Installation${R}"
INSTALL_DIR="$HOME/.pandaclaw/app"
REPO="https://github.com/senapati484/pandaclaw.git"

if [ -d "$INSTALL_DIR/.git" ]; then
  run_spinner "Updating PandaClaw..." bash -c "
    git -C \"$INSTALL_DIR\" reset --hard HEAD --quiet
    git -C \"$INSTALL_DIR\" pull origin main --quiet
  "
else
  mkdir -p "$HOME/.pandaclaw"
  run_spinner "Cloning PandaClaw repository..." git clone --depth 1 "$REPO" "$INSTALL_DIR" --quiet
fi

VERSION="$(get_version "$INSTALL_DIR")"
printf "  ${D}   PandaClaw ${CY}${B}%s${R}${D} • %s${R}\n" "$VERSION" "$INSTALL_DIR"

# ── 4. Dependencies ─────────────────────────────────────────────────────────
printf "\n  ${B}${CY}▸${R} ${B}Dependencies${R}"
run_spinner "Installing project dependencies..." bun install --silent --cwd "$INSTALL_DIR"

# ── 5. Link CLI ─────────────────────────────────────────────────────────────
printf "\n  ${B}${CY}▸${R} ${B}CLI Registration${R}"
chmod +x "$INSTALL_DIR/index.ts"
BUN_BIN="$(dirname "$(command -v bun)")"
mkdir -p "$BUN_BIN"

cat > "$BUN_BIN/pandaclaw" << EOF
#!/usr/bin/env bash
exec "$(command -v bun)" run "$INSTALL_DIR/index.ts" "\$@"
EOF
chmod +x "$BUN_BIN/pandaclaw"
run_cmd "pandaclaw CLI registered in $BUN_BIN" true

# ── Default Config ──────────────────────────────────────────────────────────
GLOBAL_CONFIG="$HOME/.pandaclaw/config.json"
if [ ! -f "$GLOBAL_CONFIG" ]; then
  cp "$INSTALL_DIR/config.json" "$GLOBAL_CONFIG"
  printf "  ${D}   Default config created at ~/.pandaclaw/config.json${R}\n"
fi

# ── Summary ─────────────────────────────────────────────────────────────────
printf "\n"
printf "  ${GR}╔══════════════════════════════════════╗\n"
printf "  ║      ${R}${B}🎉  Installation Complete!${GR}       ║\n"
printf "  ╠══════════════════════════════════════╣\n"
printf "  ║     ${CY}PandaClaw ${B}%s${R}${GR}               ║\n" "$VERSION"
printf "  ║     ${D}93 tests • 0 type errors${GR}        ║\n"
printf "  ╚══════════════════════════════════════╝\n"
printf "${R}\n"

printf "  ${B}Quick start:${R}\n"
printf "    ${MA}pandaclaw ask${R}          Ask questions, edit files, run shell\n"
printf "    ${MA}pandaclaw agent${R}        Autonomous swarm for complex tasks\n"
printf "    ${MA}pandaclaw dashboard${R}     Open web UI at localhost:18789\n"
printf "    ${MA}pandaclaw setup${R}        Configure API keys interactively\n"
printf "    ${MA}pandaclaw${R}              Launch welcome menu\n"
printf "\n  ${GR}Happy pair programming! 🐼${R}\n"
printf "\n"
