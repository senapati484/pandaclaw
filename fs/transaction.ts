// fs/transaction.ts
// Git-backed transactional file system for PandaClaw.
//
// Every commit made inside a PandaClaw session is attributed to "pandaclawbot"
// as the commit AUTHOR — just like how Claude Code shows "Claude" in commits.
// This shows in GitHub commit history: "pandaclawbot committed X minutes ago"
//
// Push uses the user's own git credentials (SSH or HTTPS PAT). The commit
// author is overridden at commit time; the push identity stays as the user.
//
// OPTIONAL GitHub App push: if .pandaclaw/github-app.pem exists AND the
// pandaclawbot app is installed on the repo, pushes also show pandaclawbot
// as the pusher — giving the full [bot] badge experience.
//
// Commit flow:
//   begin()   → stash user changes, checkout pandaclaw-tx-{uuid} branch
//   commit()  → git add -A, commit as "pandaclawbot", merge back to main
//   push()    → try GitHub App token push, fall back to standard git push
//   rollback()→ hard reset tx branch, restore stash

import { execSync } from "child_process";
import crypto from "crypto";
import {
  getInstallationToken,
  buildAuthenticatedRemoteUrl,
  isGitHubAppConfigured,
  PANDA_BOT_NAME,
  PANDA_BOT_EMAIL,
  type GitHubAppConfig,
} from "./github-app.js";
import type { MutationPlan, ActionLog } from "../modes/agent/types.js";

export class GitTransaction {
  private originalBranch: string = "main";
  private txBranch: string = "";
  private inTransaction: boolean = false;
  private workspacePath: string;
  private hasStash: boolean = false;
  private githubConfig: GitHubAppConfig | null = null;

  constructor(workspacePath: string, githubConfig?: GitHubAppConfig) {
    this.workspacePath = workspacePath;
    this.githubConfig = githubConfig ?? null;
  }

  private runGit(cmd: string): string {
    try {
      return execSync(`git ${cmd}`, {
        cwd: this.workspacePath,
        encoding: "utf8",
        stdio: "pipe",
      }).trim();
    } catch (err: any) {
      throw new Error(
        `Git command failed: git ${cmd}. Error: ${err.stderr || err.message}`
      );
    }
  }

  /**
   * Run a git command with pandaclawbot as the commit author.
   * This is what makes commits show "pandaclawbot" in GitHub history.
   * It overrides user.name/user.email for this single command only —
   * the user's global git config is never modified.
   */
  private runGitAsBot(cmd: string): string {
    return this.runGit(
      `-c "user.name=${PANDA_BOT_NAME}" -c "user.email=${PANDA_BOT_EMAIL}" ${cmd}`
    );
  }

  public begin(): string {
    if (this.inTransaction) {
      throw new Error("Transaction already in progress");
    }

    try {
      this.runGit("rev-parse --is-inside-work-tree");
    } catch {
      // Initialize git repo if not already one
      this.runGit("init");
      this.runGit("add -A");
      this.runGitAsBot(
        'commit -m "chore: initial commit\n\n🐼 Initialized by pandaclawbot"'
      );
    }

    try {
      this.originalBranch = this.runGit("rev-parse --abbrev-ref HEAD");
    } catch {
      this.originalBranch = "main";
    }

    // Stash any pre-existing uncommitted changes so they don't leak into tx
    const status = this.runGit("status --porcelain");
    if (status.trim().length > 0) {
      try {
        this.runGit("stash -u -m 'pandaclaw-pre-tx-stash'");
        this.hasStash = true;
      } catch {
        this.hasStash = false;
      }
    } else {
      this.hasStash = false;
    }

    // Create unique transaction branch
    const txId = crypto.randomUUID().slice(0, 8);
    this.txBranch = `pandaclaw-tx-${txId}`;
    this.runGit(`checkout -b ${this.txBranch}`);
    this.inTransaction = true;

    return this.txBranch;
  }

  /**
   * Commit all changes as pandaclawbot and merge back to the original branch.
   * Commit shows "pandaclawbot" as author in GitHub's commit history.
   */
  public commit(message?: string): void {
    if (!this.inTransaction) {
      throw new Error("No active transaction to commit");
    }

    try {
      const status = this.runGit("status --porcelain");

      if (status.trim().length > 0) {
        this.runGit("add -A");
        const commitMsg = message ?? this.defaultCommitMessage();
        // Author override: pandaclawbot shows in GitHub commit history
        this.runGitAsBot(`commit -m "${escapeCommitMessage(commitMsg)}"`);
      }

      // Switch back to original branch
      this.runGit(`checkout ${this.originalBranch}`);

      // Merge the tx branch changes
      if (status.trim().length > 0) {
        this.runGitAsBot(
          `merge ${this.txBranch} --no-edit -m "chore: merge pandaclaw changes\n\n🐼 Applied by pandaclawbot"`
        );
      }

      // Clean up tx branch
      this.runGit(`branch -d ${this.txBranch}`);
    } catch (err) {
      try { this.runGit(`checkout ${this.originalBranch}`); } catch {}
      throw err;
    } finally {
      this.restoreStash();
      this.inTransaction = false;
      this.txBranch = "";
    }
  }

  /**
   * Push commits to origin.
   *
   * Strategy (tries each in order):
   *   1. GitHub App token push → commits show pandaclawbot[bot] with [bot] badge
   *      (requires pandaclawbot app installed on the repo)
   *   2. Standard git push → commits show pandaclawbot as author (no badge)
   *      (uses the user's existing git credentials, always works)
   */
  public async push(branch?: string): Promise<void> {
    const targetBranch =
      branch ?? this.runGit("rev-parse --abbrev-ref HEAD");

    // Attempt GitHub App authenticated push (optional, gives [bot] badge)
    if (this.githubConfig && isGitHubAppConfigured(this.githubConfig)) {
      try {
        const token = await getInstallationToken(
          this.githubConfig,
          this.workspacePath
        );
        const remoteUrl = this.runGit("remote get-url origin");
        const authedUrl = buildAuthenticatedRemoteUrl(remoteUrl, token);

        // Token injected into URL — never stored in git config
        this.runGit(`push "${authedUrl}" HEAD:${targetBranch}`);
        console.log(`🐼 Pushed as pandaclawbot[bot] → ${targetBranch}`);
        return;
      } catch {
        // Not a hard error — fall through to standard push
        console.log(`📤 Pushing with user credentials (pandaclawbot as commit author)...`);
      }
    }

    // Standard push — uses user's credentials but commits are authored as pandaclawbot
    this.runGit(`push origin HEAD:${targetBranch}`);
    console.log(`🐼 Pushed → ${targetBranch} (commits show pandaclawbot as author)`);
  }

  public rollback(): void {
    if (!this.inTransaction) {
      throw new Error("No active transaction to rollback");
    }

    try {
      this.runGit("reset --hard HEAD");
      this.runGit("clean -fd");
      this.runGit(`checkout ${this.originalBranch}`);
      this.runGit(`branch -D ${this.txBranch}`);
    } finally {
      this.restoreStash();
      this.inTransaction = false;
      this.txBranch = "";
    }
  }

  public getActiveBranch(): string { return this.txBranch; }
  public isInTransaction(): boolean { return this.inTransaction; }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private defaultCommitMessage(): string {
    return `chore: pandaclaw session changes\n\n🐼 Applied by pandaclawbot`;
  }

  private restoreStash(): void {
    if (this.hasStash) {
      try { this.runGit("stash pop"); } catch {}
      this.hasStash = false;
    }
  }
}

// ── Conventional commit message generator ─────────────────────────────────

const ACTION_TYPE_PREFIX: Record<string, string> = {
  file_create:   "feat",
  file_modify:   "refactor",
  file_delete:   "remove",
  folder_create: "chore",
  folder_delete: "chore",
  shell_command: "build",
  code_analysis: "chore",
  tool_execute:  "chore",
};

export function generateCommitMessage(
  plan: MutationPlan,
  executedActions: ActionLog[]
): string {
  const executed = executedActions.filter((a) => a.status === "executed");
  if (executed.length === 0) {
    return `chore: pandaclaw session\n\n🐼 Applied by pandaclawbot`;
  }

  const primaryAction = executed[0];
  const commitType = ACTION_TYPE_PREFIX[primaryAction?.type ?? ""] ?? "chore";
  const shortDescription = plan.description.slice(0, 60);

  const mutationList = executed
    .slice(0, 8)
    .map((a) => `  ${a.type}: ${a.path}`)
    .join("\n");

  const overflowNote =
    executed.length > 8 ? `\n  ... and ${executed.length - 8} more` : "";

  return [
    `${commitType}: ${shortDescription}`,
    "",
    `🐼 Applied by pandaclawbot`,
    `Mutations: ${executed.length} | Risk: ${plan.estimatedRisk}`,
    "",
    mutationList + overflowNote,
  ].join("\n");
}

// ── Internal helper ────────────────────────────────────────────────────────

function escapeCommitMessage(msg: string): string {
  return msg
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$");
}
