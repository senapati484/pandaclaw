// utils/process-lock.ts
// Single-instance lock using a PID file.
// When PandaClaw starts, it checks if a previous instance is running
// and kills it automatically. No more "409 Conflict" due to ghost processes.

import fs from "fs";
import path from "path";

const LOCK_FILE = path.join(process.cwd(), ".pandaclaw", "pandaclaw.pid");

/**
 * Acquire the process lock.
 * - If a lock file exists with a live PID → kill that process and wait.
 * - Write our own PID to the lock file.
 * - Register cleanup on exit so the lock is always released.
 */
export async function acquireLock(): Promise<void> {
  // Ensure .pandaclaw dir exists
  const lockDir = path.dirname(LOCK_FILE);
  if (!fs.existsSync(lockDir)) {
    fs.mkdirSync(lockDir, { recursive: true });
  }

  // Check for existing lock
  if (fs.existsSync(LOCK_FILE)) {
    const raw = fs.readFileSync(LOCK_FILE, "utf8").trim();
    const oldPid = parseInt(raw, 10);

    if (!isNaN(oldPid) && oldPid !== process.pid) {
      const isRunning = isPidAlive(oldPid);
      if (isRunning) {
        console.warn(`\n⚠️  Killing previous PandaClaw instance (PID ${oldPid})...`);
        try {
          process.kill(oldPid, "SIGTERM");
          // Give it 1.5 seconds to stop gracefully
          await sleep(1500);
          // Force-kill if still alive
          if (isPidAlive(oldPid)) {
            process.kill(oldPid, "SIGKILL");
            await sleep(500);
          }
          console.log(`✅  Previous instance stopped.\n`);
        } catch {
          // Process may have already exited — that's fine
        }
      }
    }
  }

  // Write our PID
  fs.writeFileSync(LOCK_FILE, String(process.pid), "utf8");

  // Clean up lock on normal exit
  const cleanup = () => releaseLock();
  process.once("exit", cleanup);
  process.once("SIGINT", () => { releaseLock(); process.exit(0); });
  process.once("SIGTERM", () => { releaseLock(); process.exit(0); });
}

/** Release the lock file (called on exit) */
function releaseLock(): void {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const raw = fs.readFileSync(LOCK_FILE, "utf8").trim();
      // Only delete if we own the lock
      if (parseInt(raw, 10) === process.pid) {
        fs.unlinkSync(LOCK_FILE);
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

/** Check if a process with the given PID is still alive */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 = check existence only
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
