import { execSync } from "child_process";
import crypto from "crypto";

export class GitTransaction {
  private originalBranch: string = "main";
  private txBranch: string = "";
  private inTransaction: boolean = false;
  private workspacePath: string;
  private hasStash: boolean = false;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  private runGit(cmd: string): string {
    try {
      return execSync(`git ${cmd}`, { cwd: this.workspacePath, encoding: "utf8", stdio: "pipe" }).trim();
    } catch (err: any) {
      throw new Error(`Git command failed: git ${cmd}. Error: ${err.stderr || err.message}`);
    }
  }

  public begin(): string {
    if (this.inTransaction) {
      throw new Error("Transaction already in progress");
    }

    try {
      // Check if git is initialized
      this.runGit("rev-parse --is-inside-work-tree");
    } catch {
      // Initialize git if it's not a git repo
      this.runGit("init");
      this.runGit("add -A");
      this.runGit('commit -m "Initial commit by PandaClaw"');
    }

    try {
      this.originalBranch = this.runGit("rev-parse --abbrev-ref HEAD");
    } catch {
      this.originalBranch = "main";
    }

    // Check if there are pre-existing uncommitted changes
    const status = this.runGit("status --porcelain");
    if (status.trim().length > 0) {
      try {
        this.runGit("stash -u -m 'pandaclaw-pre-tx-stash'");
        this.hasStash = true;
      } catch (err) {
        // Fallback: if stashing fails, continue anyway
        this.hasStash = false;
      }
    } else {
      this.hasStash = false;
    }

    // Create unique branch name
    const txId = crypto.randomUUID().slice(0, 8);
    this.txBranch = `pandaclaw-tx-${txId}`;

    // Checkout to tx branch
    this.runGit(`checkout -b ${this.txBranch}`);
    this.inTransaction = true;

    return this.txBranch;
  }

  public commit(): void {
    if (!this.inTransaction) {
      throw new Error("No active transaction to commit");
    }

    try {
      // Check changes on transaction branch
      const status = this.runGit("status --porcelain");
      if (status.trim().length > 0) {
        this.runGit("add -A");
        this.runGit('commit -m "PandaClaw transaction modifications"');
      }

      // Switch back to original branch
      this.runGit(`checkout ${this.originalBranch}`);

      // Merge transaction branch back
      if (status.trim().length > 0) {
        this.runGit(`merge ${this.txBranch} --no-edit`);
      }

      // Delete tx branch
      this.runGit(`branch -d ${this.txBranch}`);
    } catch (err) {
      // Attempt safe switch back to main
      try {
        this.runGit(`checkout ${this.originalBranch}`);
      } catch {}
      throw err;
    } finally {
      this.restoreStash();
      this.inTransaction = false;
      this.txBranch = "";
    }
  }

  public rollback(): void {
    if (!this.inTransaction) {
      throw new Error("No active transaction to rollback");
    }

    try {
      // Reset all changes on tx branch
      this.runGit("reset --hard HEAD");
      this.runGit("clean -fd");

      // Switch back to original branch
      this.runGit(`checkout ${this.originalBranch}`);

      // Force delete transaction branch
      this.runGit(`branch -D ${this.txBranch}`);
    } catch (err) {
      throw err;
    } finally {
      this.restoreStash();
      this.inTransaction = false;
      this.txBranch = "";
    }
  }

  private restoreStash(): void {
    if (this.hasStash) {
      try {
        this.runGit("stash pop");
      } catch {
        // If pop fails (e.g. merge conflicts), stash is still preserved in git stack.
      }
      this.hasStash = false;
    }
  }

  public getActiveBranch(): string {
    return this.txBranch;
  }

  public isInTransaction(): boolean {
    return this.inTransaction;
  }
}
