import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { GitTransaction } from "../fs/transaction";
import { writeFileSync, existsSync, readFileSync, rmSync, mkdtempSync } from "fs";
import path from "path";
import { execSync } from "child_process";
import os from "os";

describe("GitTransaction", () => {
  let tempDir = "";
  let tx: GitTransaction;
  let testFile = "";

  beforeAll(() => {
    // Create a temporary directory for the git repository
    tempDir = mkdtempSync(path.join(os.tmpdir(), "pandaclaw-git-test-"));
    
    // Initialize git repo in the temp directory
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync("git config user.name 'Test User'", { cwd: tempDir, stdio: "ignore" });
    execSync("git config user.email 'test@example.com'", { cwd: tempDir, stdio: "ignore" });
    
    // Create an initial commit so we have a 'main' branch
    const readmePath = path.join(tempDir, "README.md");
    writeFileSync(readmePath, "# Test Repo", "utf8");
    execSync("git add README.md && git commit -m 'Initial commit'", { cwd: tempDir, stdio: "ignore" });

    tx = new GitTransaction(tempDir);
    testFile = path.join(tempDir, "tx_test_file.txt");
  });

  afterAll(() => {
    // Clean up temporary directory recursively
    if (tempDir && existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  test("begin, commit, and rollback cycle", () => {
    // 1. Begin transaction
    const branchName = tx.begin();
    expect(branchName).toContain("pandaclaw-tx-");
    expect(tx.isInTransaction()).toBe(true);

    // 2. Modify workspace
    writeFileSync(testFile, "initial transaction state", "utf8");
    expect(existsSync(testFile)).toBe(true);

    // 3. Rollback transaction
    tx.rollback();
    expect(tx.isInTransaction()).toBe(false);
    expect(existsSync(testFile)).toBe(false); // file should be removed by rollback

    // 4. Begin second transaction
    tx.begin();
    writeFileSync(testFile, "committed transaction state", "utf8");
    expect(existsSync(testFile)).toBe(true);

    // 5. Commit transaction
    tx.commit();
    expect(tx.isInTransaction()).toBe(false);
    expect(existsSync(testFile)).toBe(true);
    expect(readFileSync(testFile, "utf8")).toBe("committed transaction state");
  });
});
