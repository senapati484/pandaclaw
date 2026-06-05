// tui/daemon.ts
// Background daemon manager for macOS (launchd) and Linux (systemd).

import { existsSync, writeFileSync, mkdirSync, readFileSync, unlinkSync } from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";
import { execSync } from "child_process";
import { purple } from "../utils/brand.js";

const LABEL = "com.pandaclaw";
const HOME = os.homedir();
const PANDA_DIR = path.join(HOME, ".pandaclaw");
const LOG_FILE = path.join(PANDA_DIR, "daemon.log");

function getPlatformPaths() {
  const platform = os.platform();
  const projectDir = process.cwd();
  
  // Resolve bun path dynamically
  let bunPath = process.execPath;
  try {
    const whichBun = execSync("which bun", { encoding: "utf8" }).trim();
    if (whichBun && existsSync(whichBun)) {
      bunPath = whichBun;
    }
  } catch {}

  const serverPath = path.resolve(projectDir, "canvas/server.ts");

  if (platform === "darwin") {
    return {
      platform,
      servicePath: path.join(HOME, "Library/LaunchAgents", `${LABEL}.plist`),
      bunPath,
      serverPath,
    };
  } else if (platform === "linux") {
    return {
      platform,
      servicePath: path.join(HOME, ".config/systemd/user", `${LABEL}.service`),
      bunPath,
      serverPath,
    };
  } else {
    throw new Error(`Platform '${platform}' is not supported for background daemon mode.`);
  }
}

export function startDaemon(): void {
  // Ensure config directory exists
  if (!existsSync(PANDA_DIR)) {
    mkdirSync(PANDA_DIR, { recursive: true });
  }

  const { platform, servicePath, bunPath, serverPath } = getPlatformPaths();
  const projectDir = process.cwd();

  console.log(purple(`\n🐼 Installing background daemon...`));
  console.log(chalk.gray(`  Bun Path:  ${bunPath}`));
  console.log(chalk.gray(`  Server:    ${serverPath}`));
  console.log(chalk.gray(`  Log Path:  ${LOG_FILE}`));

  if (platform === "darwin") {
    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${bunPath}</string>
        <string>run</string>
        <string>${serverPath}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_FILE}</string>
    <key>StandardErrorPath</key>
    <string>${LOG_FILE}</string>
    <key>WorkingDirectory</key>
    <string>${projectDir}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${process.env.PATH || "/usr/local/bin:/usr/bin:/bin"}</string>
        <key>HOME</key>
        <string>${HOME}</string>
    </dict>
</dict>
</plist>`;

    writeFileSync(servicePath, plistContent, "utf8");

    try {
      // Unload first if already running
      try {
        execSync(`launchctl unload -w "${servicePath}" 2>/dev/null`);
      } catch {}

      execSync(`launchctl load -w "${servicePath}"`);
      console.log(chalk.green(`✓ Daemon started via launchd. Service: ${LABEL}`));
    } catch (err: any) {
      throw new Error(`Failed to start daemon via launchctl: ${err.message}`);
    }
  } else if (platform === "linux") {
    // Ensure systemd user config directory exists
    const systemdDir = path.dirname(servicePath);
    if (!existsSync(systemdDir)) {
      mkdirSync(systemdDir, { recursive: true });
    }

    const serviceContent = `[Unit]
Description=PandaClaw Daemon Service
After=network.target

[Service]
ExecStart=${bunPath} run ${serverPath}
Restart=always
WorkingDirectory=${projectDir}
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}
Environment="PATH=${process.env.PATH || "/usr/local/bin:/usr/bin:/bin"}"
Environment="HOME=${HOME}"

[Install]
WantedBy=default.target`;

    writeFileSync(servicePath, serviceContent, "utf8");

    try {
      execSync("systemctl --user daemon-reload");
      execSync(`systemctl --user enable --now ${LABEL}.service`);
      console.log(chalk.green(`✓ Daemon started via systemd. Service: ${LABEL}`));
    } catch (err: any) {
      throw new Error(`Failed to start daemon via systemctl: ${err.message}`);
    }
  }
}

export function stopDaemon(): void {
  const { platform, servicePath } = getPlatformPaths();
  console.log(purple(`\nStopping background daemon...`));

  if (platform === "darwin") {
    try {
      execSync(`launchctl unload -w "${servicePath}"`);
      console.log(chalk.green(`✓ Daemon stopped successfully.`));
    } catch (err: any) {
      console.warn(chalk.yellow(`⚠️ Could not unload plist (it may not be running): ${err.message}`));
    }
    if (existsSync(servicePath)) {
      try {
        unlinkSync(servicePath);
      } catch {}
    }
  } else if (platform === "linux") {
    try {
      execSync(`systemctl --user disable --now ${LABEL}.service`);
      console.log(chalk.green(`✓ Daemon stopped successfully.`));
    } catch (err: any) {
      console.warn(chalk.yellow(`⚠️ Could not disable systemd unit (it may not be running): ${err.message}`));
    }
    if (existsSync(servicePath)) {
      try {
        unlinkSync(servicePath);
      } catch {}
    }
  }
}

export function daemonStatus(): void {
  const { platform } = getPlatformPaths();
  console.log(purple(`\n🐼 PandaClaw Daemon Status:`));

  let isRunning = false;
  let pid = "N/A";

  if (platform === "darwin") {
    try {
      const output = execSync("launchctl list", { encoding: "utf8" });
      const line = output.split("\n").find(l => l.includes(LABEL));
      if (line) {
        const parts = line.trim().split(/\s+/);
        pid = parts[0] || "N/A";
        isRunning = pid !== "-" && pid !== "N/A" && parseInt(pid) > 0;
      }
    } catch {}
  } else if (platform === "linux") {
    try {
      const output = execSync(`systemctl --user is-active ${LABEL}.service`, { encoding: "utf8" }).trim();
      isRunning = output === "active";
      if (isRunning) {
        pid = execSync(`systemctl --user show --property=MainPID --value ${LABEL}.service`, { encoding: "utf8" }).trim();
      }
    } catch {}
  }

  if (isRunning) {
    console.log(`  Status:   ${chalk.green("● running")}`);
    console.log(`  PID:      ${pid}`);
    console.log(`  Endpoint: http://localhost:18789`);
    console.log(`  Logs:     tail with ${chalk.bold("pandaclaw daemon logs")}`);
  } else {
    console.log(`  Status:   ${chalk.red("○ stopped")}`);
    console.log(`  Start with: ${chalk.bold("pandaclaw daemon start")}`);
  }
}

export function tailDaemonLogs(linesCount = 50): void {
  if (!existsSync(LOG_FILE)) {
    console.log(chalk.yellow(`No daemon logs found at ${LOG_FILE}`));
    return;
  }

  console.log(purple(`\n📋 Tailing last ${linesCount} lines of ${LOG_FILE}:\n`));
  try {
    const raw = readFileSync(LOG_FILE, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const subset = lines.slice(-linesCount);
    console.log(subset.join("\n"));
  } catch (err: any) {
    console.error(chalk.red(`Failed to read logs: ${err.message}`));
  }
}
