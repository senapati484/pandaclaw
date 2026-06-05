// utils/brand.ts
// Single source of truth for PandaClaw's brand constants — color palette,
// emoji, and a couple of pre-themed helpers. Used by every CLI/TUI surface
// to keep the look-and-feel consistent.

import chalk, { type ChalkInstance } from "chalk";

/** Primary brand purple — used for headers, banners, and the default theme. */
const BRAND_PURPLE = "#5b4d9e";

/** Lighter brand accent — used inside Telegram's box-drawing borders. */
const BRAND_LAVENDER = "#e8dcf8";

/** The panda emoji. The whole product is named after this. */
export const PANDA = "🐼";

/** A `chalk` instance already themed with the brand purple. */
export const purple: ChalkInstance = chalk.hex(BRAND_PURPLE);

/** A `chalk` instance already themed with the brand lavender. */
export const lavender: ChalkInstance = chalk.hex(BRAND_LAVENDER);

/**
 * Print a brand-stamped section header. The "🐼 " prefix is part of the
 * brand voice; "Section Title" is bolded for legibility.
 */
export function banner(title: string): string {
  return purple(`\n${PANDA} ${chalk.bold(title)}\n`);
}
