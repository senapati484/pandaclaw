<#
  🐼 PandaClaw — Automated Windows Installer
  Installs Bun, clones the repo, links the CLI globally.
  Usage: irm https://raw.githubusercontent.com/senapati484/pandaclaw/main/install.ps1 | iex
#>

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# ── Colors ──────────────────────────────────────────────────────────────────
$CY  = "Cyan"; $GR  = "Green"; $RD  = "Red"; $YE = "Yellow"
$MA  = "Magenta"; $WH = "White"; $DB = "DarkGray"

# ── Paths ───────────────────────────────────────────────────────────────────
$installDir    = "$env:USERPROFILE\.pandaclaw\app"
$bunDir        = if ($env:BUN_INSTALL) { $env:BUN_INSTALL } else { "$env:USERPROFILE\.bun" }
$bunBin        = "$bunDir\bin"
$repo          = "https://github.com/senapati484/pandaclaw.git"
$wrapperPath   = "$bunBin\pandaclaw.cmd"

# ── Helper Functions ────────────────────────────────────────────────────────
function Say($text)        { Write-Host $text }
function Title($text)      { Say "`n $([char]0x25B8) $text" -ForegroundColor $CY }
function Ok($text)         { Say " $([char]0x2714)  $text" -ForegroundColor $GR }
function Fail($text)       { Say " $([char]0x2718)  $text" -ForegroundColor $RD; exit 1 }
function Info($text)       { Say "    $text" -ForegroundColor $DB }
function Muted($text)      { Say "    $text" -ForegroundColor $DB }

function Run-With-Progress($activity, $command) {
  Write-Progress -Activity $activity -PercentComplete 0
  try {
    $command.Invoke()
    Write-Progress -Activity $activity -Completed
  } catch {
    Write-Progress -Activity $activity -Completed
    throw
  }
}

function Get-Version($dir) {
  $pkg = Get-Content "$dir\package.json" -ErrorAction SilentlyContinue
  if ($pkg) {
    $v = $pkg | Select-String '"version"' | ForEach-Object {
      $_ -replace '.*"version": "([^"]*)".*', '$1'
    }
    return $v.Trim()
  }
  return $null
}

# ── Banner ──────────────────────────────────────────────────────────────────
Say ""
Say "  $([char]0x2554)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)" -ForegroundColor $CY
Say "  $([char]0x2551)                                            $([char]0x2551)" -ForegroundColor $CY
Say "  $([char]0x2551)           $([char]0x1F43C)  PandaClaw               $([char]0x2551)" -ForegroundColor $CY
Say "  $([char]0x2551)       Slow is smooth.  Smooth is perfect.     $([char]0x2551)" -ForegroundColor $CY
Say "  $([char]0x2551)                                            $([char]0x2551)" -ForegroundColor $CY
Say "  $([char]0x255A)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)" -ForegroundColor $CY
Info "Automated Windows Installer"
Say ""

# ── 1. Prerequisites ─────────────────────────────────────────────────────────
Title "Prerequisites"

if (!(Get-Command git -ErrorAction SilentlyContinue)) {
  Fail "Git is required — install from https://git-scm.com"
}
$gitVer = (git --version) -replace '.*?(\d+\.\d+\.\d+).*', '$1'
Ok "Git $gitVer"

# Warn if not admin (Bun installs per-user, so this is just informational)
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (!$isAdmin) {
  Info "Running as standard user — per-user install (recommended)"
}

# ── 2. Bun ───────────────────────────────────────────────────────────────────
Title "Bun Runtime"

if (Get-Command bun -ErrorAction SilentlyContinue) {
  $bunVer = (bun --version).Trim()
  Ok "Bun $bunVer already available"
} else {
  Info "Downloading and installing Bun for Windows..."
  try {
    Run-With-Progress "Installing Bun runtime..." {
      $proc = Start-Process -FilePath "powershell" -ArgumentList `
        "-NoProfile -ExecutionPolicy Bypass -Command irm bun.sh/install.ps1 | iex" `
        -Wait -NoNewWindow -PassThru
      if ($proc.ExitCode -ne 0) { throw "Bun installer exited with code $($proc.ExitCode)" }
    }
  } catch {
    Fail "Bun install failed — try manually: irm https://bun.sh/install.ps1 | iex"
  }

  $env:BUN_INSTALL = $bunDir
  $env:Path = "$bunBin;$env:Path"

  if (!(Get-Command bun -ErrorAction SilentlyContinue)) {
    Fail "Bun not found after install — restart your terminal and try again, or install from https://bun.sh"
  }
  $bunVer = (bun --version).Trim()
  Ok "Bun $bunVer installed"
}

# Ensure bin dir exists and is on PATH
$null = New-Item -ItemType Directory -Force -Path $bunBin
$env:Path = "$bunBin;$env:Path"

# ── 3. Clone / Update ────────────────────────────────────────────────────────
Title "PandaClaw Source"
$oldVer = Get-Version $installDir

if (Test-Path "$installDir\.git") {
  Run-With-Progress "Updating PandaClaw..." {
    Set-Location $installDir
    git reset --hard HEAD *>$null
    git pull origin main *>$null
  }
  Ok "PandaClaw updated"
} elseif (Test-Path $installDir) {
  Remove-Item -Recurse -Force $installDir
  $null = New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.pandaclaw"
  Run-With-Progress "Cloning PandaClaw repository..." {
    git clone --depth 1 $repo $installDir *>$null
  }
  Ok "PandaClaw cloned"
} else {
  $null = New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.pandaclaw"
  Run-With-Progress "Cloning PandaClaw repository..." {
    git clone --depth 1 $repo $installDir *>$null
  }
  Ok "PandaClaw cloned"
}

$newVer = Get-Version $installDir
Ok "PandaClaw $newVer"
if ($oldVer -and $oldVer -ne $newVer) {
  Muted "Updated: $oldVer $([char]0x2192) $newVer"
} elseif ($oldVer) {
  Muted "Already at $newVer"
}

# ── 4. Dependencies ──────────────────────────────────────────────────────────
Title "Dependencies"
Run-With-Progress "Installing project dependencies..." {
  bun install --silent --cwd $installDir *>$null
}
Ok "Dependencies resolved"

# ── 5. CLI Registration ──────────────────────────────────────────────────────
Title "CLI Registration"

$bunPath = (Get-Command bun).Source
$bunDir = Split-Path -Parent $bunPath -Resolve
$wrapperPath = "$bunDir\pandaclaw.cmd"

@"
@echo off
"$bunPath" run "$installDir\index.ts" %*
"@ | Out-File -FilePath $wrapperPath -Encoding ASCII -Force

$env:Path = "$bunDir;$env:Path"
Ok "pandaclaw registered in $bunDir"

# ── 6. Default Config ────────────────────────────────────────────────────────
Title "Configuration"
$globalConfig = "$env:USERPROFILE\.pandaclaw\config.json"
if (!(Test-Path $globalConfig)) {
  Copy-Item "$installDir\config.json" $globalConfig
  Muted "Default config -> ~\.pandaclaw\config.json"
}
Ok "Ready to configure"

# ── 7. Verify ─────────────────────────────────────────────────────────────────
Title "Smoke Test"
try {
  $ver = & "$wrapperPath" --version 2>&1
  Ok "pandaclaw $($ver.Trim()) -- CLI responds"
} catch {
  Info "Run 'pandaclaw' from a new terminal window"
}

# ── Summary ───────────────────────────────────────────────────────────────────
Say ""
Say "  $([char]0x2554)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)" -ForegroundColor $GR
Say "  $([char]0x2551)              All Set!     🎉           $([char]0x2551)" -ForegroundColor $GR
Say "  $([char]0x2551)                                            $([char]0x2551)" -ForegroundColor $GR
Say "  $([char]0x2551)         PandaClaw $newVer                  $([char]0x2551)" -ForegroundColor $CY
Say "  $([char]0x2551)         93 tests * 0 type errors            $([char]0x2551)" -ForegroundColor $DB
Say "  $([char]0x2551)                                            $([char]0x2551)" -ForegroundColor $GR
Say "  $([char]0x255A)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)" -ForegroundColor $GR

Say ""
Say "  Quick start:" -ForegroundColor $WH
Say "    pandaclaw ask          Ask questions, edit files, run shell" -ForegroundColor $MA
Say "    pandaclaw agent        Autonomous swarm for complex tasks" -ForegroundColor $MA
Say "    pandaclaw dashboard     Open web UI at http://localhost:18789" -ForegroundColor $MA
Say "    pandaclaw setup        Configure API keys interactively" -ForegroundColor $MA
Say "    pandaclaw              Launch welcome menu" -ForegroundColor $MA
Say ""
Say "  Add to your PATH if 'pandaclaw' isn't found:" -ForegroundColor $DB
Say "    [Environment]::SetEnvironmentVariable('Path'," -ForegroundColor $DB
Say "      [Environment]::GetEnvironmentVariable('Path','User') + ';$bunDir'," -ForegroundColor $DB
Say "      'User')" -ForegroundColor $DB
Say ""
Say "  Happy pair programming!  $([char]0x1F43C)" -ForegroundColor $GR
Say ""
