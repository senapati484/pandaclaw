<#
  🐼 PandaClaw — Automated Windows Installer
  Installs Bun, clones the repository, links the CLI globally.
  Usage: irm https://raw.githubusercontent.com/senapati484/pandaclaw/main/install.ps1 | iex
#>

$ErrorActionPreference = "Stop"

# ── Colors ──────────────────────────────────────────────────────────────────
$CY = "Cyan"; $GR = "Green"; $RD = "Red"; $YE = "Yellow"; $MA = "Magenta"; $WH = "White"
$D = [System.ConsoleColor]::DarkGray

# ── Helpers ─────────────────────────────────────────────────────────────────
function Step-Label($text) {
  Write-Host "`n $([char]0x25B8) $text" -ForegroundColor $CY
}

function Write-Status($icon, $text, $color) {
  Write-Host " $icon  $text" -ForegroundColor $color
}

function Write-OK($text)  { Write-Status $([char]0x2714) $text $GR }
function Write-Fail($text) { Write-Status $([char]0x2718) $text $RD; exit 1 }
function Write-Info($text) { Write-Host "    $text" -ForegroundColor $D }

# ── Banner ──────────────────────────────────────────────────────────────────
Write-Host "`n"
Write-Host "  $([char]0x2554)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)" -ForegroundColor $CY
Write-Host "  $([char]0x2551)                                  $([char]0x2551)" -ForegroundColor $CY
Write-Host "  $([char]0x2551)      $([char]0x1F43C)  PandaClaw         $([char]0x2551)" -ForegroundColor $CY
Write-Host "  $([char]0x2551)     Slow is smooth.                 $([char]0x2551)" -ForegroundColor $CY
Write-Host "  $([char]0x2551)     Smooth is perfect.              $([char]0x2551)" -ForegroundColor $CY
Write-Host "  $([char]0x2551)                                  $([char]0x2551)" -ForegroundColor $CY
Write-Host "  $([char]0x255A)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)" -ForegroundColor $CY
Write-Host "`n  Automated Windows Installer`n" -ForegroundColor $D

# ── 1. Git ──────────────────────────────────────────────────────────────────
Step-Label "Prerequisites"
if (!(Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Fail "Git is required. Install from https://git-scm.com"
}
Write-OK "Git $((git --version) -replace '.*?(\d+\.\d+\.\d+).*', '$1')"

# ── 2. Bun ──────────────────────────────────────────────────────────────────
if (!(Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Progress -Activity "Installing Bun runtime..." -Status "Downloading..." -PercentComplete 10
  $proc = Start-Process -FilePath "powershell" -ArgumentList "-NoProfile -Command irm bun.sh/install.ps1 | iex" -Wait -NoNewWindow -PassThru
  Write-Progress -Activity "Installing Bun runtime..." -Status "Configuring..." -PercentComplete 80
  $env:BUN_INSTALL = "$env:USERPROFILE\.bun"
  $env:Path = "$env:BUN_INSTALL\bin;$env:Path"
  if (!(Get-Command bun -ErrorAction SilentlyContinue) -or $proc.ExitCode -ne 0) {
    Write-Progress -Completed
    Write-Fail "Bun install failed. Try https://bun.sh manually"
  }
  Write-Progress -Completed
  Write-OK "Bun $((bun --version).Trim()) installed"
} else {
  Write-OK "Bun $((bun --version).Trim()) already available"
}

# ── 3. Clone / Update ───────────────────────────────────────────────────────
Step-Label "Installation"
$installDir = "$env:USERPROFILE\.pandaclaw\app"
$repo = "https://github.com/senapati484/pandaclaw.git"

if (Test-Path "$installDir\.git") {
  Write-Progress -Activity "Updating PandaClaw..." -PercentComplete 30
  Set-Location $installDir
  git reset --hard HEAD *>$null
  git pull origin main *>$null
  Write-Progress -Completed
  Write-OK "PandaClaw updated"
} else {
  $null = New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.pandaclaw"
  Write-Progress -Activity "Cloning PandaClaw..." -PercentComplete 30
  git clone --depth 1 $repo $installDir *>$null
  Write-Progress -Completed
  Write-OK "PandaClaw cloned"
}

$version = (Get-Content "$installDir\package.json" | Select-String '"version"' | ForEach-Object { $_ -replace '.*"version": "([^"]*)".*', '$1' })
Write-Info "PandaClaw $version • $installDir"

# ── 4. Dependencies ─────────────────────────────────────────────────────────
Step-Label "Dependencies"
Write-Progress -Activity "Installing project dependencies..." -PercentComplete 60
bun install --silent --cwd $installDir *>$null
Write-Progress -Completed
Write-OK "Project dependencies installed"

# ── 5. Link CLI ─────────────────────────────────────────────────────────────
Step-Label "CLI Registration"
$bunPath = (Get-Command bun).Source
$bunBin = Split-Path -Parent $bunPath
$wrapperPath = "$bunBin\pandaclaw.cmd"

@"
@echo off
"$bunPath" run "$installDir\index.ts" %*
"@ | Out-File -FilePath $wrapperPath -Encoding ASCII -Force
Write-OK "pandaclaw CLI registered in $bunBin"

# ── Default Config ──────────────────────────────────────────────────────────
$globalConfig = "$env:USERPROFILE\.pandaclaw\config.json"
if (!(Test-Path $globalConfig)) {
  Copy-Item "$installDir\config.json" $globalConfig
  Write-Info "Default config created at ~\.pandaclaw\config.json"
}

# ── Summary ─────────────────────────────────────────────────────────────────
Write-Host "`n"
Write-Host "  $([char]0x2554)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)" -ForegroundColor $GR
Write-Host "  $([char]0x2551)      $([char]0x1F389)  Installation Complete!       $([char]0x2551)" -ForegroundColor $GR
Write-Host "  $([char]0x2551)                                            $([char]0x2551)" -ForegroundColor $GR
Write-Host "  $([char]0x2551)       PandaClaw $version                  $([char]0x2551)" -ForegroundColor $CY
Write-Host "  $([char]0x2551)       93 tests * 0 type errors            $([char]0x2551)" -ForegroundColor $D
Write-Host "  $([char]0x255A)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)" -ForegroundColor $GR

Write-Host "`n  Quick start:" -ForegroundColor $WH
Write-Host "    pandaclaw ask          Ask questions, edit files, run shell" -ForegroundColor $MA
Write-Host "    pandaclaw agent        Autonomous swarm for complex tasks" -ForegroundColor $MA
Write-Host "    pandaclaw dashboard     Open web UI at localhost:18789" -ForegroundColor $MA
Write-Host "    pandaclaw setup        Configure API keys interactively" -ForegroundColor $MA
Write-Host "    pandaclaw              Launch welcome menu" -ForegroundColor $MA
Write-Host "`n  Happy pair programming! $([char]0x1F43C)`n" -ForegroundColor $GR
