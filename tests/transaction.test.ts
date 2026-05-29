import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { GitTransaction } from "../fs/transaction";
import { writeFileSync, existsSync, readFileSync, unlinkSync } from "fs";
import path from "path";
import { execSync } from "child_process";

describe("GitTransaction", () => {
  const workspacePath = path.resolve(".");
  let tx: GitTransaction;
  const testFile = path.join(workspacePath, "tx_test_file.txt");

  beforeAll(() => {
    tx = new GitTransaction(workspacePath);
    if (existsSync(testFile)) {
      unlinkSync(testFile);
    }
  });

  afterAll(() => {
    if (existsSync(testFile)) {
      unlinkSync(testFile);
      try {
        execSync("git add tx_test_file.txt && git commit -m 'Test cleanup' || true", { stdio: "ignore" });
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
