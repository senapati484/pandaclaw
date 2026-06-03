import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";

export interface TestResult {
  passed: boolean;
  command: string;
  total: number;
  passedTests: number;
  failedTests: number;
  output: string;
  errors: string[];
}

export function detectTestRunner(projectRoot: string): string | null {
  const hasBunLock = existsSync(resolve(projectRoot, "bun.lock")) || existsSync(resolve(projectRoot, "bun.lockb"));
  if (hasBunLock) return "bun";

  if (existsSync(resolve(projectRoot, "package.json"))) {
    const pkg = require(resolve(projectRoot, "package.json"));
    const scripts = pkg.scripts || {};

    if (scripts.test) {
      if (scripts.test.includes("bun")) return "bun";
      if (scripts.test.includes("vitest")) return "vitest";
      if (scripts.test.includes("jest")) return "jest";
      if (scripts.test.includes("mocha")) return "mocha";
      if (scripts.test.includes("ava")) return "ava";
      if (scripts.test.includes("tap")) return "tap";
      return "npm";
    }

    if (pkg.devDependencies?.vitest || pkg.dependencies?.vitest) return "vitest";
    if (pkg.devDependencies?.jest || pkg.dependencies?.jest) return "jest";
    if (pkg.devDependencies?.mocha || pkg.dependencies?.mocha) return "mocha";
  }

  return null;
}

export function runTests(projectRoot: string, targetPaths?: string[]): TestResult {
  const runner = detectTestRunner(projectRoot);

  if (!runner) {
    return {
      passed: false,
      command: "",
      total: 0,
      passedTests: 0,
      failedTests: 0,
      output: "No test runner detected",
      errors: ["No test runner found (bun test, vitest, jest, mocha)"],
    };
  }

  let command: string;
  if (targetPaths && targetPaths.length > 0) {
    const relativePaths = targetPaths.map((p) => {
      try { return resolve(projectRoot, p); } catch { return p; }
    }).join(" ");

    switch (runner) {
      case "bun":   command = `cd "${projectRoot}" && bun test ${relativePaths}`; break;
      case "vitest": command = `cd "${projectRoot}" && npx vitest run ${relativePaths}`; break;
      case "jest":  command = `cd "${projectRoot}" && npx jest ${relativePaths}`; break;
      case "mocha": command = `cd "${projectRoot}" && npx mocha ${relativePaths}`; break;
      default:      command = `cd "${projectRoot}" && npm test -- ${relativePaths}`;
    }
  } else {
    const scripts = getTestScript(projectRoot);
    if (scripts) {
      command = `cd "${projectRoot}" && ${scripts}`;
    } else {
      switch (runner) {
        case "bun":   command = `cd "${projectRoot}" && bun test`; break;
        case "vitest": command = `cd "${projectRoot}" && npx vitest run`; break;
        case "jest":  command = `cd "${projectRoot}" && npx jest`; break;
        default:      command = `cd "${projectRoot}" && npm test`;
      }
    }
  }

  try {
    const output = execSync(command, {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 120_000,
      stdio: "pipe",
    });

    const result = parseTestOutput(output, runner);
    return {
      ...result,
      command,
      passed: result.failedTests === 0,
    };
  } catch (err: any) {
    const output = err.stdout || "";
    const stderr = err.stderr || "";
    const result = parseTestOutput(output || stderr, runner);

    return {
      ...result,
      command,
      passed: false,
      output: output || stderr,
      errors: result.errors.length > 0 ? result.errors : [stderr.slice(0, 500)],
    };
  }
}

function getTestScript(projectRoot: string): string | null {
  try {
    const pkg = require(resolve(projectRoot, "package.json"));
    if (pkg.scripts?.test) return pkg.scripts.test;
  } catch {}
  return null;
}

function parseTestOutput(output: string, runner: string): Omit<TestResult, "passed" | "command"> {
  const common: Omit<TestResult, "passed" | "command"> = {
    total: 0,
    passedTests: 0,
    failedTests: 0,
    output,
    errors: [],
  };

  const errorLines: string[] = [];
  const lines = output.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Bun format: "X pass" / "X fail" / "Ran X tests"
    const passMatch = line.match(/(\d+)\s+pass/);
    const failMatch = line.match(/(\d+)\s+fail/);
    const ranMatch = line.match(/Ran\s+(\d+)\s+tests/);

    if (passMatch) common.passedTests = parseInt(passMatch[1]!, 10);
    if (failMatch) common.failedTests = parseInt(failMatch[1]!, 10);
    if (ranMatch) common.total = parseInt(ranMatch[1]!, 10);

    if (line.includes("error:") || line.includes("FAIL") || line.includes("✗")) {
      const nextLine = lines[i + 1]?.trim();
      const detail = nextLine ? `${line.trim()}: ${nextLine}` : line.trim();
      errorLines.push(detail);
    }
  }

  if (common.total === 0) {
    const totalMatch = output.match(/Tests:\s+(\d+)/) || output.match(/(\d+)\s+tests?/);
    if (totalMatch) common.total = parseInt(totalMatch[1]!, 10);
  }

  common.errors = errorLines.slice(0, 10);
  return common;
}

export function runTestsForChangedFiles(projectRoot: string, changedFiles: string[]): TestResult {
  const testFiles = changedFiles
    .map((f) => {
      const dir = f.split("/").slice(0, -1).join("/");
      const name = f.split("/").pop()?.replace(/\.(ts|tsx|js|jsx)$/, "") ?? "";
      return [`${dir}/${name}.test.ts`, `${dir}/${name}.test.js`, `${dir}/${name}.spec.ts`, `${dir}/${name}.spec.js`];
    })
    .flat()
    .filter((p) => existsSync(resolve(projectRoot, p)));

  if (testFiles.length === 0) {
    return {
      passed: true,
      command: "",
      total: 0,
      passedTests: 0,
      failedTests: 0,
      output: "No test files found for changed files",
      errors: [],
    };
  }

  return runTests(projectRoot, testFiles);
}
