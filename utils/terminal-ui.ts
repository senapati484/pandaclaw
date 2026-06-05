/**
 * terminal-ui.ts
 * Reusable terminal box-drawing and text-wrapping utilities.
 * Extracted from modes/agent/orchestrator.ts for separation of concerns.
 */
import chalk from "chalk";

/** Strip ANSI escape codes to get the visible character length of a string */
export const stripAnsi = (str: string): string =>
  str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");

/**
 * Word-wrap a single terminal line to `width` visible characters,
 * preserving ANSI sequences and leading indentation.
 */
export function wrapLine(line: string, width: number): string[] {
  if (line.startsWith("─")) return [line];

  const stripped = stripAnsi(line);
  if (stripped.length <= width) return [line];

  const match = line.match(/^(\s*)/);
  const indent = (match && match[1]) || "";

  // Split by whitespace while preserving ANSI sequences
  const tokens =
    line.trim().match(/(\x1B\[[0-9;]*[a-zA-Z]|[^\s\x1B]+)+/g) || [];

  const wrappedLines: string[] = [];
  let currentLine = indent;

  for (const token of tokens) {
    if (!token) continue;
    const currentLength = stripAnsi(currentLine).length;
    const tokenLength = stripAnsi(token).length;

    if (currentLine === indent) {
      currentLine += token;
    } else if (currentLength + 1 + tokenLength <= width) {
      currentLine += " " + token;
    } else {
      wrappedLines.push(currentLine);
      currentLine = indent + "  " + token; // indent wrapped parts slightly more
    }
  }

  if (currentLine !== indent) wrappedLines.push(currentLine);

  return wrappedLines.length > 0 ? wrappedLines : [line];
}

/**
 * Draw a bordered box with a title and body lines in the terminal.
 *
 * @param title       - Header text shown in the title row
 * @param lines       - Body lines; a line containing only "─" renders as a divider
 * @param themeColor  - A chalk color function used for all borders
 */
export function drawBox(
  title: string,
  lines: string[],
  themeColor: (str: string) => string
): void {
  const innerWidth = 76;
  const borderTop = themeColor("╭" + "─".repeat(innerWidth + 2) + "╮");
  const borderBottom = themeColor("╰" + "─".repeat(innerWidth + 2) + "╯");
  const divider = themeColor("├" + "─".repeat(innerWidth + 2) + "┤");

  const titleStr = ` ${title} `;
  const visibleTitleLen = stripAnsi(titleStr).length;
  const titlePadding = Math.max(0, innerWidth - visibleTitleLen);
  const titleLine =
    themeColor("│ ") +
    chalk.bold.hex("#e8dcf8")(titleStr) +
    " ".repeat(titlePadding) +
    themeColor(" │");

  console.log(borderTop);
  console.log(titleLine);
  console.log(divider);

  // Flatten multi-line strings
  const flatLines: string[] = [];
  for (const line of lines) {
    if (line.includes("\n")) {
      flatLines.push(...line.split("\n"));
    } else {
      flatLines.push(line);
    }
  }

  for (const line of flatLines) {
    if (line === "─" || line.startsWith("─")) {
      console.log(divider);
      continue;
    }
    const wrapped = wrapLine(line, innerWidth);
    for (const wLine of wrapped) {
      const visibleLength = stripAnsi(wLine).length;
      const padding = Math.max(0, innerWidth - visibleLength);
      console.log(themeColor("│ ") + wLine + " ".repeat(padding) + themeColor(" │"));
    }
  }

  console.log(borderBottom);
}
