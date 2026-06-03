# install.ps1
# Automated installer for PandaClaw on Windows - Installs Bun, clones the app, installs dependencies, and links the CLI globally.

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  🐼 Welcome to the PandaClaw Windows Installer 🐼" -ForegroundColor Purple
Write-Host "  ===============================================" -ForegroundColor Purple
Write-Host ""

# 1. Check for Git
if (!(Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "❌ git is not installed. Please install Git (https://git-scm.com) and try again." -ForegroundColor Red
    Exit 1
}
Write-Host "✓ Git is installed" -ForegroundColor Green

# 2. Check for Bun (native runtime for PandaClaw)
if (!(Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host "⚡ Bun is required but was not found. Installing Bun for Windows..." -ForegroundColor Blue
    
    # Official Bun installation on Windows via powershell
    powershell -c "irm bun.sh/install.ps1 | iex"
    
    # Refresh PATH environment variable for current session
    $env:BUN_INSTALL = "$env:USERPROFILE\.bun"
    $env:Path = "$env:BUN_INSTALL\bin;$env:Path"
    
    if (!(Get-Command bun -ErrorAction SilentlyContinue)) {
        Write-Host "❌ Bun installation failed or is not on PATH." -ForegroundColor Red
        Write-Host "Please install Bun manually from https://bun.sh and re-run this script." -ForegroundColor Red
        Exit 1
    }
    Write-Host "✓ Bun installed successfully!" -ForegroundColor Green
} else {
    $bunVersion = (bun --version).Trim()
    Write-Host "✓ Bun is already installed ($bunVersion)" -ForegroundColor Green
}

# 3. Create app installation folder
$installDir = "$env:USERPROFILE\.pandaclaw\app"
Write-Host "📂 Setting up installation directory at $installDir..." -ForegroundColor Blue

if (Test-Path $installDir) {
    Write-Host "Existing PandaClaw installation found. Pulling latest updates..." -ForegroundColor Cyan
    Set-Location $installDir
    # Reset local changes in app dir if any to prevent merge conflicts
    git reset --hard HEAD | Out-Null
    git pull origin main
} else {
    $parentDir = "$env:USERPROFILE\.pandaclaw"
    if (!(Test-Path $parentDir)) {
        New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
    }
    git clone https://github.com/senapati484/pandaclaw.git $installDir
    Set-Location $installDir
}

# 4. Install npm dependencies using Bun
Write-Host "📦 Installing project dependencies..." -ForegroundColor Blue
bun install

# 5. Global CLI Linking
Write-Host "🔗 Registering 'pandaclaw' CLI command globally..." -ForegroundColor Blue
if (Get-Command npm -ErrorAction SilentlyContinue) {
    # npm install -g . is the most reliable cross-platform global linker
    try {
        npm install -g .
        Write-Host "✓ Registered globally via npm" -ForegroundColor Green
    } catch {
        Write-Host "NPM linking failed. Attempting with bun link..." -ForegroundColor Yellow
        bun link
    }
} else {
    bun link
}

# 6. Initialize Global Config if it doesn't exist
$globalConfigDir = "$env:USERPROFILE\.pandaclaw"
$globalConfigPath = "$globalConfigDir\config.json"

if (!(Test-Path $globalConfigPath)) {
    Write-Host "⚙️ Initializing global config.json..." -ForegroundColor Blue
    if (!(Test-Path $globalConfigDir)) {
        New-Item -ItemType Directory -Force -Path $globalConfigDir | Out-Null
    }
    Copy-Item "$installDir\config.json" $globalConfigPath
}

Write-Host ""
Write-Host "🎉 PandaClaw has been installed successfully! 🎉" -ForegroundColor Green
Write-Host ""
Write-Host "Quick start:" -ForegroundColor Cyan
Write-Host "  pandaclaw setup        — Configure API keys" -ForegroundColor Purple
Write-Host "  pandaclaw ask           — Ask questions, edit files, run commands" -ForegroundColor Purple
Write-Host "  pandaclaw dashboard     — Open the web UI (port 18789)" -ForegroundColor Purple
Write-Host "  pandaclaw               — Launch the welcome menu" -ForegroundColor Purple
Write-Host ""
Write-Host "Happy pair programming! 🐼" -ForegroundColor Cyan
Write-Host ""
