import { writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const PREFERRED_LOG_LEVELS: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getLogLevelFromEnv(): LogLevel {
  const env = (process.env.PANDACLAW_LOG_LEVEL || "info").toLowerCase();
  if (env in PREFERRED_LOG_LEVELS) return env as LogLevel;
  return "info";
}

const currentLogLevel = getLogLevelFromEnv();

interface LogEvent {
  timestamp: string;
  level: LogLevel;
  message: string;
  details?: Record<string, unknown>;
  sessionId?: string;
  durationMs?: number;
}

export class Logger {
  private sessionId: string;
  private logFilePath: string | null = null;
  private events: LogEvent[] = [];

  constructor(sessionId: string, logDir?: string) {
    this.sessionId = sessionId;
    if (logDir) {
      this.logFilePath = resolve(logDir, "events.jsonl");
      const dir = dirname(this.logFilePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  private log(level: LogLevel, message: string, details?: Record<string, unknown>, durationMs?: number): void {
    if ((PREFERRED_LOG_LEVELS[level] ?? 99) < (PREFERRED_LOG_LEVELS[currentLogLevel] ?? 99)) return;

    const event: LogEvent = {
      timestamp: new Date().toISOString(),
      level,
      message,
      details,
      sessionId: this.sessionId,
      durationMs,
    };

    this.events.push(event);

    const prefix = `[${level.toUpperCase()}] [${this.sessionId.slice(0, 8)}]`;
    const durationTag = durationMs !== undefined ? ` (${durationMs}ms)` : "";

    switch (level) {
      case "error":
        console.error(`${prefix} ${message}${durationTag}`, details ?? "");
        break;
      case "warn":
        console.warn(`${prefix} ${message}${durationTag}`, details ?? "");
        break;
      case "debug":
        console.debug(`${prefix} ${message}${durationTag}`);
        break;
      default:
        console.log(`${prefix} ${message}${durationTag}`);
    }

    if (this.logFilePath) {
      try {
        appendFileSync(this.logFilePath, JSON.stringify(event) + "\n", "utf8");
      } catch {}
    }
  }

  debug(message: string, details?: Record<string, unknown>): void {
    this.log("debug", message, details);
  }

  info(message: string, details?: Record<string, unknown>): void {
    this.log("info", message, details);
  }

  warn(message: string, details?: Record<string, unknown>): void {
    this.log("warn", message, details);
  }

  error(message: string, details?: Record<string, unknown>): void {
    this.log("error", message, details);
  }

  timed<T>(message: string, fn: () => Promise<T>, details?: Record<string, unknown>): Promise<T> {
    const start = performance.now();
    return fn().then((result) => {
      const durationMs = Math.round(performance.now() - start);
      this.log("info", message, details, durationMs);
      return result;
    }).catch((err) => {
      const durationMs = Math.round(performance.now() - start);
      this.log("error", `${message} FAILED`, { ...details, error: err.message }, durationMs);
      throw err;
    });
  }

  getEvents(): LogEvent[] {
    return [...this.events];
  }

  getRecentEvents(level?: LogLevel, limit = 10): LogEvent[] {
    let filtered = this.events;
    if (level) {
      filtered = filtered.filter((e) => e.level === level || (PREFERRED_LOG_LEVELS[e.level] ?? 99) >= (PREFERRED_LOG_LEVELS[level] ?? 99));
    }
    return filtered.slice(-limit);
  }

  exportJson(): string {
    return JSON.stringify(this.events, null, 2);
  }
}

let _globalLogger: Logger | null = null;

export function getGlobalLogger(sessionId?: string): Logger {
  if (!_globalLogger || sessionId) {
    _globalLogger = new Logger(sessionId ?? "global", ".pandaclaw");
  }
  return _globalLogger;
}

export function resetGlobalLogger(): void {
  _globalLogger = null;
}
