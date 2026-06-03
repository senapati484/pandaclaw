#!/usr/bin/env bash

# install.sh
# Automated installer for PandaClaw - Installs Bun, clones the app, installs dependencies, and links the CLI globally.

set -e

# ANSI escape codes for styling
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${PURPLE}"
echo "  🐼 Welcome to the PandaClaw Installer 🐼"
echo "  ======================================="
echo -e "${NC}"

# 1. Check for git
if ! command -v git &> /dev/null; then
    echo -e "${RED}❌ git is not installed. Please install git and try again.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Git is installed${NC}"

# 2. Check for Bun (native runtime for PandaClaw)
if ! command -v bun &> /dev/null; then
    echo -e "${BLUE}⚡ Bun is required but was not found. Installing Bun...${NC}"
    curl -fsSL https://bun.sh/install | bash
    
    # Export bun path immediately for the installer session
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
    
    # Double check if Bun works now
    if ! command -v bun &> /dev/null; then
        # Try loading shell config
        if [ -f "$HOME/.zshrc" ]; then
            source "$HOME/.zshrc" &> /dev/null || true
        elif [ -f "$HOME/.bashrc" ]; then
            source "$HOME/.bashrc" &> /dev/null || true
        fi
    fi
    
    if ! command -v bun &> /dev/null; then
        echo -e "${RED}❌ Bun installation failed or is not on PATH.${NC}"
        echo -e "${RED}Please install Bun manually from https://bun.sh and re-run this script.${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Bun installed successfully!${NC}"
else
    echo -e "${GREEN}✓ Bun is already installed (${BLUE}$(bun --version)${GREEN})${NC}"
fi

# 3. Create app installation folder
INSTALL_DIR="$HOME/.pandaclaw/app"
echo -e "${BLUE}📂 Setting up installation directory at $INSTALL_DIR...${NC}"

if [ -d "$INSTALL_DIR" ]; then
    echo -e "${CYAN}Existing PandaClaw installation found. Pulling latest updates...${NC}"
    cd "$INSTALL_DIR"
    # Reset local changes in app dir if any to prevent merge conflicts
    git reset --hard HEAD &> /dev/null || true
    git pull origin main
else
    mkdir -p "$HOME/.pandaclaw"
    git clone https://github.com/senapati484/pandaclaw.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# 4. Install npm dependencies using Bun
echo -e "${BLUE}📦 Installing project dependencies...${NC}"
bun install

# 5. Make the entrypoint executable
chmod +x "$INSTALL_DIR/index.ts"

# 6. Global CLI Linking
echo -e "${BLUE}🔗 Registering 'pandaclaw' CLI command globally...${NC}"
if command -v npm &> /dev/null; then
    # npm install -g . is the most reliable cross-platform global linker
    if npm install -g . &> /dev/null; then
        echo -e "${GREEN}✓ Registered globally via npm${NC}"
    elif [ -x "$(command -v sudo)" ]; then
        echo -e "${BLUE}🔒 Global directory requires write permissions. Retrying with sudo...${NC}"
        if sudo npm install -g . &> /dev/null; then
            echo -e "${GREEN}✓ Registered globally via npm (with sudo)${NC}"
        else
            echo -e "${BLUE}Retrying with bun link...${NC}"
            sudo bun link &> /dev/null || bun link &> /dev/null
        fi
    else
        bun link &> /dev/null
    fi
else
    bun link &> /dev/null
fi

# 7. Initialize Global Config if it doesn't exist
GLOBAL_CONFIG_DIR="$HOME/.pandaclaw"
GLOBAL_CONFIG_PATH="$GLOBAL_CONFIG_DIR/config.json"

if [ ! -f "$GLOBAL_CONFIG_PATH" ]; then
    echo -e "${BLUE}⚙️ Initializing global config.json...${NC}"
    mkdir -p "$GLOBAL_CONFIG_DIR"
    cp "$INSTALL_DIR/config.json" "$GLOBAL_CONFIG_PATH"
fi

echo -e "\n${GREEN}🎉 PandaClaw has been installed successfully! 🎉${NC}"
echo -e ""
echo -e "${CYAN}Quick start:${NC}"
echo -e "  ${PURPLE}pandaclaw setup${NC}        — Configure API keys"
echo -e "  ${PURPLE}pandaclaw ask${NC}           — Ask questions, edit files, run commands"
echo -e "  ${PURPLE}pandaclaw dashboard${NC}     — Open the web UI (port 18789)"
echo -e "  ${PURPLE}pandaclaw${NC}               — Launch the welcome menu"
echo -e ""
echo -e "${CYAN}Happy pair programming! 🐼${NC}\n"
