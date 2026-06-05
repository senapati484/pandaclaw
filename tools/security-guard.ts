import type { RiskLevel } from "../modes/agent/types.js";

export interface SecurityConfig {
  default?: Record<string, RiskLevel>;
  [platform: string]: Record<string, RiskLevel> | undefined;
}

export interface SecurityDecision {
  allowed: boolean;
  reason?: string;
}

const DEFAULT_RISK: Record<string, RiskLevel> = {
  file_read: "safe",
  list_dir: "safe",
  web_search: "safe",
  web_fetch: "safe",
  memory_recall: "safe",
  canvas_control: "safe",
  file_write: "ask",
  code_exec: "ask",
  app_control: "ask",
  alarm_set: "ask",
};

export class SecurityGuard {
  private config: SecurityConfig;
  private auditPath: string;

  constructor(config: SecurityConfig, auditPath: string) {
    this.config = config;
    this.auditPath = auditPath;
  }

  async check(
    tool: string,
    platform: string,
    requestConsent?: (tool: string, preview: string) => Promise<boolean>,
  ): Promise<SecurityDecision> {
    const level = this.effectiveLevel(tool, platform);
    const args = {};

    switch (level) {
      case "safe":
        await this.audit(tool, platform, "safe", "auto-approved");
        return { allowed: true };

      case "deny":
        await this.audit(tool, platform, "deny", `blocked on ${platform}`);
        return {
          allowed: false,
          reason: `Tool '${tool}' is not allowed on ${platform}.`,
        };

      case "ask": {
        if (!requestConsent) {
          await this.audit(tool, platform, "deny", "no consent handler");
          return { allowed: false, reason: `Tool '${tool}' requires consent but no handler available.` };
        }
        const preview = `Tool: ${tool}`;
        let approved: boolean;
        try {
          approved = await requestConsent(tool, preview);
        } catch {
          approved = false;
        }
        if (approved) {
          await this.audit(tool, platform, "ask", "approved");
          return { allowed: true };
        }
        await this.audit(tool, platform, "ask", "rejected");
        return { allowed: false, reason: "User declined" };
      }
    }
  }

  private effectiveLevel(tool: string, platform: string): RiskLevel {
    const platformOverrides = this.config[platform];
    if (platformOverrides && tool in platformOverrides) {
      const level = platformOverrides[tool];
      if (level) return level;
    }
    const defaultOverrides = this.config.default;
    if (defaultOverrides && tool in defaultOverrides) {
      const level = defaultOverrides[tool];
      if (level) return level;
    }
    return DEFAULT_RISK[tool] ?? "safe";
  }

  private async audit(tool: string, platform: string, level: string, result: string): Promise<void> {
    try {
      const entry = JSON.stringify({
        timestamp: new Date().toISOString(),
        event: "security_check",
        tool,
        platform,
        level,
        result,
      }) + "\n";
      const file = Bun.file(this.auditPath);
      const writer = file.writer();
      writer.write(entry);
      await writer.flush();
    } catch (err) {
      // Audit write failure should never block tool execution, but the
      // operator should know. Fall back to stderr — better than silent.
      console.error(`[security-guard] audit write failed: ${(err as Error)?.message ?? err}`);
    }
  }
}

export { DEFAULT_RISK };
