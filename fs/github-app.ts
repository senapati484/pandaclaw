// fs/github-app.ts
// PandaClaw git identity — makes every commit show "pandaclawbot" as the author.
//
// How it works (same approach as Claude Code, Copilot Workspace, etc.):
//
//   Every commit PandaClaw makes uses:
//     git -c user.name="pandaclawbot" -c user.email="pandaclawbot@gmail.com" commit
//
//   This makes GitHub show "pandaclawbot" in commit history without needing
//   a GitHub App installation on every user's repo.
//
//   Users push using their own git credentials (SSH key or HTTPS token).
//   PandaClaw just stamps the commit author — that's it.
//
// OPTIONAL: If users want the [bot] badge (blue badge like GitHub Actions bots),
// they can install the pandaclawbot GitHub App on their repo — the code below
// supports it but it is NOT required.

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import crypto from "crypto";

// ── Types ──────────────────────────────────────────────────────────────────

export interface GitHubAppConfig {
  app_id: string;
  /** Optional — if empty, auto-detected from git remote via GitHub API */
  installation_id?: string;
  pem_path: string;
  bot_name?: string;
  bot_email?: string;
}

interface CachedToken {
  token: string;
  expiresAt: number; // unix ms
}

// ── Caches ─────────────────────────────────────────────────────────────────

const _tokenCache        = new Map<string, CachedToken>();
const _installationCache = new Map<string, string>(); // repoKey → installationId

// ── JWT creation (for optional GitHub App push) ───────────────────────────

/**
 * Generate a GitHub App JWT for authenticating API calls.
 * Only needed if you want GitHub App push authentication (optional).
 */
export function generateJWT(appId: string, pemPath: string): string {
  const fullPemPath = pemPath.startsWith("/")
    ? pemPath
    : join(process.cwd(), pemPath);

  if (!existsSync(fullPemPath)) {
    throw new Error(
      `GitHub App private key not found at: ${fullPemPath}\n` +
      `Download from: github.com/settings/apps/pandaclawbot → Private keys\n` +
      `Save as: ${pemPath}`
    );
  }

  const privateKey = readFileSync(fullPemPath, "utf8");
  const now = Math.floor(Date.now() / 1000);

  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" })
  ).toString("base64url");

  const payload = Buffer.from(
    JSON.stringify({
      iat: now - 60,  // 60s clock-skew buffer
      exp: now + 600, // 10 min max (GitHub requirement)
      iss: appId,
    })
  ).toString("base64url");

  const signingInput = `${header}.${payload}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signingInput);
  const signature = sign.sign(privateKey, "base64url");

  return `${signingInput}.${signature}`;
}

// ── Auto-detect installation ID from git remote ───────────────────────────

/**
 * Extract the GitHub owner/repo from the current workspace's git remote URL.
 * Handles both HTTPS and SSH remotes.
 */
export function extractOwnerRepo(
  workspacePath: string
): { owner: string; repo: string } | null {
  try {
    const remote = execSync("git remote get-url origin", {
      cwd: workspacePath,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();

    // HTTPS: https://github.com/owner/repo.git
    const httpsMatch = remote.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/);
    if (httpsMatch && httpsMatch[1] && httpsMatch[2]) {
      return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }

    // SSH: git@github.com:owner/repo.git
    const sshMatch = remote.match(/github\.com:([^/]+)\/([^/.]+?)(?:\.git)?$/);
    if (sshMatch && sshMatch[1] && sshMatch[2]) {
      return { owner: sshMatch[1], repo: sshMatch[2] };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Auto-detect the GitHub App installation ID for the current repo.
 * Uses GET /repos/{owner}/{repo}/installation authenticated with App JWT.
 *
 * This is OPTIONAL — only needed for GitHub App authenticated push.
 * Returns null if the app is not installed on the repo (not an error).
 */
export async function autoDetectInstallationId(
  appId: string,
  pemPath: string,
  workspacePath: string = process.cwd()
): Promise<string | null> {
  const ownerRepo = extractOwnerRepo(workspacePath);
  if (!ownerRepo) return null;

  const cacheKey = `${ownerRepo.owner}/${ownerRepo.repo}`;
  if (_installationCache.has(cacheKey)) {
    return _installationCache.get(cacheKey)!;
  }

  try {
    const jwt = generateJWT(appId, pemPath);
    const response = await fetch(
      `https://api.github.com/repos/${ownerRepo.owner}/${ownerRepo.repo}/installation`,
      {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "pandaclawbot/1.0",
        },
      }
    );

    if (!response.ok) return null; // App not installed on this repo — that's OK

    const data = (await response.json()) as { id: number };
    const installationId = String(data.id);
    _installationCache.set(cacheKey, installationId);
    return installationId;
  } catch {
    return null;
  }
}

// ── Installation token exchange ────────────────────────────────────────────

/**
 * Get a short-lived installation access token (1 hour, cached).
 * Used to push as pandaclawbot[bot] via x-access-token authentication.
 */
async function fetchInstallationToken(
  installationId: string,
  jwt: string
): Promise<string> {
  const cacheKey = `token:${installationId}`;
  const cached = _tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) {
    return cached.token;
  }

  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "pandaclawbot/1.0",
      },
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub App token request failed (${response.status}): ${body}`
    );
  }

  const data = (await response.json()) as { token: string; expires_at: string };
  const expiresAt = new Date(data.expires_at).getTime();
  _tokenCache.set(cacheKey, { token: data.token, expiresAt });
  return data.token;
}

/**
 * Get an installation token, auto-detecting installation ID if not set.
 * OPTIONAL — only used for push authentication if GitHub App is installed.
 */
export async function getInstallationToken(
  config: GitHubAppConfig,
  workspacePath: string = process.cwd()
): Promise<string> {
  let installationId = config.installation_id;

  if (!installationId || installationId === "" || installationId === "FILL_IN") {
    installationId = await autoDetectInstallationId(
      config.app_id,
      config.pem_path,
      workspacePath
    ) ?? undefined;
  }

  if (!installationId) {
    throw new Error(
      `GitHub App not installed on this repo.\n` +
      `Install pandaclawbot to get push authentication: https://github.com/apps/pandaclawbot\n` +
      `Note: commits still show pandaclawbot as author even without this.`
    );
  }

  const jwt = generateJWT(config.app_id, config.pem_path);
  return fetchInstallationToken(installationId, jwt);
}

// ── Remote URL builder ─────────────────────────────────────────────────────

/**
 * Inject installation token into a GitHub remote URL.
 * https://github.com/user/repo.git → https://x-access-token:{token}@github.com/user/repo.git
 */
export function buildAuthenticatedRemoteUrl(
  remoteUrl: string,
  token: string
): string {
  const clean = remoteUrl.replace(/https:\/\/[^@]+@/, "https://");
  return clean.replace("https://", `https://x-access-token:${token}@`);
}

// ── Availability check ─────────────────────────────────────────────────────

/**
 * Returns true if the .pem file exists (minimum required for JWT generation).
 * The GitHub App push is optional — commit author override always works.
 */
export function isGitHubAppConfigured(config: GitHubAppConfig): boolean {
  const fullPemPath = config.pem_path.startsWith("/")
    ? config.pem_path
    : join(process.cwd(), config.pem_path);
  return existsSync(fullPemPath);
}

// ── Bot identity ───────────────────────────────────────────────────────────

/**
 * The commit author name PandaClaw uses on every commit.
 * This is what shows in GitHub's commit history — same approach as Claude Code.
 * The [bot] badge only appears for GitHub App accounts, which requires users
 * to install the pandaclawbot app. The name always shows regardless.
 */
export const PANDA_BOT_NAME = "pandaclawbot";

/**
 * Bot email — shown in commit details.
 * Using pandaclawbot@gmail.com means GitHub will resolve the Gravatar
 * for this email and show the panda logo next to every commit.
 * Set up Gravatar at: https://gravatar.com with this email + upload the panda logo.
 */
export const PANDA_BOT_EMAIL = "pandaclawbot@gmail.com";
