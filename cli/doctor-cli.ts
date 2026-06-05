// cli/doctor-cli.ts
// `pandaclaw doctor [--fix] [--json] [--only <ids...>]` — print a health
// report, optionally auto-repairing what's fixable.
//
// Structure:
//   - doctorCommand()  top-level orchestrator (5-line entry point)
//   - filterReport()   narrows a report to a subset of check ids
//   - printJson()      --json path
//   - printHuman()     default human-readable path
//   - printFixSection  --fix result summary

import chalk from "chalk";
import { runChecks, type CheckResult, type DoctorReport, type Severity } from "../modes/doctor/checks.js";
import { applyFixes, type FixSummary } from "../modes/doctor/fixer.js";
import { purple, banner } from "../utils/brand.js";

export interface DoctorOptions {
  fix?: boolean;
  json?: boolean;
  /** When provided, only fix / report on these check ids. */
  only?: string[];
}

const ICON: Record<Severity, string> = { ok: "✓", warn: "!", fail: "✗", info: "·" };
const COLOR: Record<Severity, (s: string) => string> = {
  ok: chalk.green,
  warn: chalk.yellow,
  fail: chalk.red,
  info: chalk.gray,
};
const SEVERITY_ORDER: Severity[] = ["fail", "warn", "info", "ok"];
const SEVERITY_LABEL: Record<Severity, string> = {
  fail: "FAILURES",
  warn: "WARNINGS",
  info: "INFO",
  ok: "OK",
};
const ID_COL_WIDTH = 32;

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function isFilterActive(opts: DoctorOptions): boolean {
  return !!opts.only && opts.only.length > 0;
}

function filterReport(all: DoctorReport, ids: string[] | undefined): DoctorReport {
  if (!ids || ids.length === 0) return all;
  const matching = all.results.filter((r) => ids.includes(r.id));
  const summary = { ok: 0, warn: 0, fail: 0, info: 0, total: matching.length };
  for (const r of matching) summary[r.severity]++;
  return { ...all, results: matching, summary };
}

function countFixable(results: CheckResult[]): number {
  return results.filter((r) => r.fixable && r.severity !== "ok").length;
}

function printResult(r: CheckResult): void {
  const icon = COLOR[r.severity](pad(ICON[r.severity], 2));
  const fixTag = r.fixable ? chalk.cyan(" [fixable]") : "";
  console.log(`${icon} ${pad(r.id, ID_COL_WIDTH)} ${r.message}${fixTag}`);
  if (r.detail) {
    for (const line of r.detail.split("\n")) {
      console.log(chalk.gray(`     ${line}`));
    }
  }
}

function printHeader(report: DoctorReport): void {
  console.log(banner("PandaClaw Doctor"));
  console.log(chalk.gray(`  Bun ${report.bunVersion} · ${report.cwd} · ${report.ranAt}\n`));
}

function printGroupedResults(results: CheckResult[]): void {
  const grouped: Record<Severity, CheckResult[]> = { fail: [], warn: [], info: [], ok: [] };
  for (const r of results) grouped[r.severity].push(r);

  for (const sev of SEVERITY_ORDER) {
    const list = grouped[sev];
    if (list.length === 0) continue;
    console.log(chalk.bold(`  ${SEVERITY_LABEL[sev]} (${list.length})`));
    for (const r of list) printResult(r);
    console.log();
  }
}

function printSummary(report: DoctorReport): void {
  const s = report.summary;
  console.log(chalk.gray(`  Summary: ${s.ok} ok · ${s.warn} warn · ${s.fail} fail · ${s.info} info\n`));
}

function printFixSection(report: DoctorReport, ids: string[] | undefined): void {
  const fixableCount = countFixable(report.results);
  if (fixableCount === 0) {
    console.log(chalk.gray("  Nothing to fix.\n"));
    return;
  }

  const summary: FixSummary = applyFixes(report, { ids });
  console.log(chalk.bold("  --fix results\n"));
  for (const r of summary.results) {
    const icon = r.ok ? chalk.green("✓") : chalk.red("✗");
    console.log(`  ${icon} ${pad(r.id, ID_COL_WIDTH)} ${r.message}`);
  }
  if (summary.unfixable.length > 0) {
    console.log(chalk.gray(`\n  ${summary.unfixable.length} check(s) could not be auto-fixed:`));
    for (const r of summary.unfixable) {
      console.log(chalk.gray(`    - ${r.id}: ${r.message}`));
    }
  }
  console.log();
}

function printFixHint(report: DoctorReport): void {
  if (countFixable(report.results) === 0) return;
  const n = countFixable(report.results);
  console.log(chalk.cyan(`  💡 ${n} issue(s) are auto-fixable. Re-run with \`pandaclaw doctor --fix\` to repair.\n`));
}

function printJson(report: DoctorReport, opts: DoctorOptions): void {
  if (opts.fix) {
    const fix = applyFixes(report, { ids: opts.only });
    console.log(JSON.stringify({ report, fix }, null, 2));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

function printHuman(report: DoctorReport, opts: DoctorOptions): void {
  printHeader(report);
  printGroupedResults(report.results);
  printSummary(report);
  if (opts.fix) {
    printFixSection(report, opts.only);
  } else {
    printFixHint(report);
  }
}

export function doctorCommand(opts: DoctorOptions = {}): DoctorReport {
  const all = runChecks();
  const report = isFilterActive(opts) ? filterReport(all, opts.only) : all;
  if (opts.json) printJson(report, opts);
  else printHuman(report, opts);
  return report;
}
