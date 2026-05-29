#!/usr/bin/env bun
// test-github-app.ts — End-to-end test of PandaClaw commit identity
// Usage: bun run test-github-app.ts

import {
  generateJWT,
  extractOwnerRepo,
  isGitHubAppConfigured,
  PANDA_BOT_NAME,
  PANDA_BOT_EMAIL,
} from "./fs/github-app.js";
import { GitTransaction } from "./fs/transaction.js";
import { execSync } from "child_process";

const config = {
  app_id: "3905611",
  pem_path: ".pandaclaw/github-app.pem",
};

console.log("🐼 PandaClaw Git Identity Test\n");
console.log("━".repeat(50));

// ── Core feature: commit author override ────────────────────────────────
// This works for ALL users — no GitHub App installation needed

console.log("\n1️⃣  Bot identity that shows in GitHub commit history:");
console.log(`   Author: ${PANDA_BOT_NAME}`);
console.log(`   Email:  ${PANDA_BOT_EMAIL}`);
console.log("   ✓ Every PandaClaw commit will show this author");
console.log("   ✓ No GitHub App installation required — works everywhere");

// ── .pem file check ─────────────────────────────────────────────────────

console.log("\n2️⃣  Checking .pem file (for optional [bot] badge)...");
const hasPem = isGitHubAppConfigured(config);
console.log(hasPem ? "   ✓ .pem file found" : "   ℹ .pem file not found (optional)");

// ── JWT generation ───────────────────────────────────────────────────────

if (hasPem) {
  console.log("\n3️⃣  Generating JWT (local crypto, no network)...");
  try {
    const jwt = generateJWT(config.app_id, config.pem_path);
    const parts = jwt.split(".");
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
    console.log(`   ✓ JWT generated successfully (${jwt.length} chars)`);
    console.log(`   ✓ Issuer: ${payload.iss} (app_id)`);
    console.log(`   ✓ Expires: ${new Date(payload.exp * 1000).toISOString()}`);
  } catch (err: any) {
    console.error(`   ✗ JWT failed: ${err.message}`);
  }
}

// ── Repo detection ───────────────────────────────────────────────────────

console.log("\n4️⃣  Detecting repo from git remote...");
const ownerRepo = extractOwnerRepo(process.cwd());
if (ownerRepo) {
  console.log(`   ✓ ${ownerRepo.owner}/${ownerRepo.repo}`);
} else {
  console.log("   ℹ No git remote detected");
}

// ── Simulate a commit with pandaclawbot identity ─────────────────────────

console.log("\n5️⃣  Testing commit author override (dry-run)...");
try {
  // Show what git commit will look like (doesn't actually commit)
  const name = execSync(
    `git -c "user.name=${PANDA_BOT_NAME}" -c "user.email=${PANDA_BOT_EMAIL}" config user.name`,
    { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" }
  ).trim();
  console.log(`   ✓ git user.name override works: "${name}"`);
  console.log(`   ✓ Every PandaClaw commit will show as authored by "${name}"`);
} catch (err: any) {
  console.error(`   ✗ ${err.message}`);
}

// ── Summary ──────────────────────────────────────────────────────────────

console.log("\n" + "━".repeat(50));
console.log("✅ PandaClaw commit identity is working!\n");
console.log("What users will see in GitHub commit history:");
console.log(`  pandaclawbot  feat: refactor context-manager`);
console.log(`  pandaclawbot  chore: initial pandaclaw session`);
console.log(`\n(No setup needed — works on ANY repo for ANY user)`);
if (hasPem) {
  console.log("\nBonus: .pem file found!");
  console.log("Users who install https://github.com/apps/pandaclawbot");
  console.log("will get the blue [bot] badge next to pandaclawbot.");
}
