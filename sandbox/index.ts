export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface SandboxOptions {
  cwd?: string;
  timeoutMs?: number;
  allowedEnv?: string[];
}

export class BunSandbox {
  private allowedEnvKeys = [
    "PATH",
    "HOME",
    "USER",
    "LANG",
    "LC_ALL",
    "PWD",
  ];

  constructor(customAllowedEnv?: string[]) {
    if (customAllowedEnv) {
      this.allowedEnvKeys = [...this.allowedEnvKeys, ...customAllowedEnv];
    }
  }

  public async execute(command: string[], options: SandboxOptions = {}): Promise<SandboxResult> {
    const cwd = options.cwd ?? process.cwd();
    const timeoutMs = options.timeoutMs ?? 10_000;

    // Filter environment variables to protect credentials and API tokens
    const cleanEnv: Record<string, string> = {};
    const allowedKeys = options.allowedEnv 
      ? [...this.allowedEnvKeys, ...options.allowedEnv] 
      : this.allowedEnvKeys;

    for (const key of allowedKeys) {
      if (process.env[key] !== undefined) {
        cleanEnv[key] = process.env[key]!;
      }
    }

    const startTime = performance.now();

    try {
      const proc = Bun.spawn(command, {
        cwd,
        env: cleanEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Implement timeout logic
      let timer: Timer | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          try {
            proc.kill();
          } catch {}
          reject(new Error(`Sandbox execution timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      // Wait for process completion or timeout
      const exitCode = await Promise.race([
        proc.exited,
        timeoutPromise
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });

      const stdoutBytes = await new Response(proc.stdout).arrayBuffer();
      const stderrBytes = await new Response(proc.stderr).arrayBuffer();

      const stdout = new TextDecoder().decode(stdoutBytes).trim();
      const stderr = new TextDecoder().decode(stderrBytes).trim();
      const durationMs = Math.round(performance.now() - startTime);

      return {
        stdout,
        stderr,
        exitCode,
        durationMs,
      };
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - startTime);
      return {
        stdout: "",
        stderr: err.message || String(err),
        exitCode: -1,
        durationMs,
      };
    }
  }
}
