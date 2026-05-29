import { expect, test, describe } from "bun:test";
import { BunSandbox } from "../sandbox/index";

describe("BunSandbox", () => {
  test("runs simple commands and captures stdout", async () => {
    const sandbox = new BunSandbox();
    const result = await sandbox.execute(["echo", "hello sandbox"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello sandbox");
  });

  test("filters environment variables", async () => {
    // Set a custom env variable on parent process
    process.env.SECRET_API_KEY = "supersecret123";

    const sandbox = new BunSandbox();
    // In our sandbox, SECRET_API_KEY should be filtered out
    const result = await sandbox.execute(["bun", "-e", "console.log(process.env.SECRET_API_KEY || 'missing')"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("missing");

    // Clean up parent env
    delete process.env.SECRET_API_KEY;
  });

  test("allows specified environment variables", async () => {
    process.env.MY_ALLOWED_VAR = "allowed-value";

    const sandbox = new BunSandbox(["MY_ALLOWED_VAR"]);
    const result = await sandbox.execute(["bun", "-e", "console.log(process.env.MY_ALLOWED_VAR || 'missing')"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("allowed-value");

    delete process.env.MY_ALLOWED_VAR;
  });

  test("enforces timeouts", async () => {
    const sandbox = new BunSandbox();
    const result = await sandbox.execute(["sleep", "2"], { timeoutMs: 100 });
    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toContain("timed out after 100ms");
  });
});
