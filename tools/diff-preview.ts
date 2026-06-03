import { readFileSync, existsSync } from "fs";
import chalk from "chalk";

export interface DiffLine {
  type: "added" | "removed" | "unchanged";
  oldLine: number;
  newLine: number;
  content: string;
}

export interface DiffResult {
  filePath: string;
  lines: DiffLine[];
  added: number;
  removed: number;
  unchanged: number;
}

function longestCommonSubsequence(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const aVal = a[i - 1]!;
      const bVal = b[j - 1]!;
      if (aVal === bVal) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  return dp;
}

function backtrackLCS(dp: number[][], a: string[], b: string[], i: number, j: number): DiffLine[] {
  const lines: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      const aVal = a[i - 1]!;
      lines.unshift({
        type: "unchanged",
        oldLine: i,
        newLine: j,
        content: aVal,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      const bVal = b[j - 1]!;
      lines.unshift({
        type: "added",
        oldLine: -1,
        newLine: j,
        content: bVal,
      });
      j--;
    } else if (i > 0) {
      const aVal = a[i - 1]!;
      lines.unshift({
        type: "removed",
        oldLine: i,
        newLine: -1,
        content: aVal,
      });
      i--;
    }
  }

  return lines;
}

export function computeDiff(oldContent: string, newContent: string): DiffLine[] {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  const dp = longestCommonSubsequence(oldLines, newLines);
  return backtrackLCS(dp, oldLines, newLines, oldLines.length, newLines.length);
}

export function computeFileDiff(filePath: string, newContent: string): DiffResult | null {
  if (!existsSync(filePath)) {
    const lines = newContent.split("\n").map((content, i) => ({
      type: "added" as const,
      oldLine: -1,
      newLine: i + 1,
      content,
    }));

    return {
      filePath,
      lines,
      added: lines.length,
      removed: 0,
      unchanged: 0,
    };
  }

  const oldContent = readFileSync(filePath, "utf8");
  const diffLines = computeDiff(oldContent, newContent);

  return {
    filePath,
    lines: diffLines,
    added: diffLines.filter((l) => l.type === "added").length,
    removed: diffLines.filter((l) => l.type === "removed").length,
    unchanged: diffLines.filter((l) => l.type === "unchanged").length,
  };
}

export function renderDiffSummary(diff: DiffResult, maxLines = 8): string {
  const lines: string[] = [];
  const { filePath, added, removed, unchanged } = diff;

  lines.push(chalk.underline(filePath));
  lines.push(chalk.gray(`  ${unchanged} unchanged, ${chalk.green(`+${added}`)} added, ${chalk.red(`-${removed}`)} removed`));

  const contextLines: DiffLine[] = [];
  let trailingUnchanged = 0;

  for (const line of diff.lines) {
    if (line.type === "unchanged") {
      if (contextLines.length > 0 || trailingUnchanged < 2) {
        contextLines.push(line);
        trailingUnchanged++;
      } else if (contextLines.length < maxLines + 3) {
        contextLines.push({ type: "unchanged", oldLine: -1, newLine: -1, content: "..." });
      }
    } else {
      contextLines.push(line);
      trailingUnchanged = 0;
    }
  }

  const previewLines = contextLines.slice(0, maxLines + 10);
  for (const line of previewLines) {
    if (line.content === "...") {
      lines.push(chalk.gray("  ..."));
      continue;
    }
    switch (line.type) {
      case "added":
        lines.push(chalk.green(`+ ${line.content}`));
        break;
      case "removed":
        lines.push(chalk.red(`- ${line.content}`));
        break;
      case "unchanged":
        lines.push(chalk.gray(`  ${line.content}`));
        break;
    }
  }

  if (diff.lines.length > previewLines.length) {
    lines.push(chalk.gray(`  ... and ${diff.lines.length - previewLines.length} more lines`));
  }

  return lines.join("\n");
}
