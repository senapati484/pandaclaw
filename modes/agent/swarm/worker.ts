import type { SwarmTask, SwarmContext, SwarmWorkerType } from "./types.js";
import type { PandaConfig } from "../../../ai/ai.config.js";
import { runTool } from "../../../tools/index.js";
import { callLLM } from "../../../ai/llm.js";
import chalk from "chalk";

export class SwarmWorker {
  private type: SwarmWorkerType;
  private config: PandaConfig;
  /** Per-role token ceiling. Researchers/verifiers get small budgets;
   *  only the coder role gets the full 4096-token window. */
  private maxTokens: number;

  constructor(type: SwarmWorkerType, config: PandaConfig, maxTokens = 1024) {
    this.type = type;
    this.config = config;
    this.maxTokens = maxTokens;
  }

  public async run(
    task: SwarmTask,
    context: SwarmContext,
    onProgress?: (message: string) => void
  ): Promise<SwarmTask> {
    task.status = "in_progress";

    try {

      let systemPrompt = "";
      switch (this.type) {
        case "researcher":
          systemPrompt = `You are a researcher worker agent in a PandaClaw swarm.
Your goal is to gather facts, search the web, read files, or analyze data.
You have tools to read files, search the web, list directories, and fetch URLs.
CRITICAL: Do NOT guess or make assumptions about file contents. If you need to explain, verify, or analyze a file, directory, or repository, you MUST first list the files using 'list_dir' and then read the actual contents of the key files (such as README.md, package.json, main configuration files, or entry points) using 'file_read' before finalizing your response. Your output must be highly accurate and grounded in the actual file contents.`;
          break;
        case "coder":
          systemPrompt = `You are a coding specialist worker agent in a PandaClaw swarm.
Your goal is to implement, edit, or create files, and write working, production-quality code.
You have tools to write files, read files, list directories, and execute code.

CRITICAL RULES — follow ALL of these without exception:

1. READ BEFORE WRITE: Before modifying any existing file, call file_read to get its current content so your changes integrate without breaking anything.

2. PORTABLE PATHS — never hardcode paths:
   - Python : os.path.expanduser("~"), pathlib.Path.home(), os.path.join(...)
   - Shell  : $HOME, $USER, $(pwd)
   - Node   : os.homedir(), process.cwd(), path.join(...)

3. ROBUSTNESS — all code must be production-quality:
   - Python  : wrap ALL IO/network calls in try/except with specific exception types
   - Shell   : start every .sh script with "set -euo pipefail"
   - Node/Bun: use try/catch for all async calls; never leave unhandled promise rejections
   - Always add a shebang: "#!/usr/bin/env python3" (Python), "#!/usr/bin/env bash" (Shell)

4. INTERACTIVE INPUT — stdin is NOT a TTY inside code_exec:
   - If the script uses input() (Python) or readline (Node), add a non-interactive fallback
   - Check sys.stdin.isatty() (Python) or process.stdin.isTTY (Node)
   - Catch EOFError or provide sys.argv-based input mode as fallback
   - The fallback must run a self-contained demo that proves correctness

5. WRITE → VERIFY → FIX LOOP (mandatory — do not skip):
   STEP 1. file_write the code → check the "syntaxCheck" field in the response
   STEP 2. If syntaxCheck is "SYNTAX ERROR" → file_read to inspect, fix it, file_write again
   STEP 3. code_exec to RUN the file → check exitCode in the response
   STEP 4. If exitCode !== 0 → read the "hint" field, apply the fix, rewrite, re-run
   STEP 5. Repeat STEP 3–4 up to 3 attempts
   STEP 6. Only mark the task as complete after exitCode === 0

6. DEPENDENCIES: Before importing a third-party package, verify it's installed:
   - Python: code_exec "python3 -c 'import <pkg>'" — if it fails, run "pip3 install <pkg>" first
   - Node  : code_exec "node -e \"require('<pkg>')\""  — if it fails, run "bun add <pkg>" first`;
          break;
        case "verifier":
          systemPrompt = `You are a verification specialist worker agent in a PandaClaw swarm.
Your goal is to check correctness, sanity check files, run tests, and critique outputs.
You have tools to read files, list directories, write files, and execute tests.
CRITICAL: Verify code correctness by inspecting the code structure or running tests. Do not just assume things are correct.`;
          break;
        case "visualizer":
          systemPrompt = `You are a visual design worker agent in a PandaClaw swarm.
Your goal is to locate coordinate details, format reports, or outline mockups.`;
          break;
      }

      // Define standard tool schemas for OpenAI/Groq function calling
      const apiTools = [
        {
          type: "function",
          function: {
            name: "web_search",
            description: "Search the web for current information about a topic",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "The search query" }
              },
              required: ["query"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "web_fetch",
            description: "Fetch web content of a URL and strip HTML tags",
            parameters: {
              type: "object",
              properties: {
                url: { type: "string", description: "Target URL to fetch" }
              },
              required: ["url"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "file_read",
            description: "Read the content of a file in the workspace",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "Relative file path from workspace root" }
              },
              required: ["path"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "list_dir",
            description: "List the files and directories in the workspace (recursively or not)",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "Relative directory path (default: .)" },
                recursive: { type: "boolean", description: "Whether to list subdirectories recursively (default: false)" }
              }
            }
          }
        },
        {
          type: "function",
          function: {
            name: "file_write",
            description: "Write or overwrite content of a file at a specific path",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "Relative path of the target file" },
                content: { type: "string", description: "Full content string to write" }
              },
              required: ["path", "content"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "code_exec",
            description: "Execute TypeScript/JavaScript code in a sandboxed file",
            parameters: {
              type: "object",
              properties: {
                code: { type: "string", description: "The TS/JS code to run" },
                timeout: { type: "number", description: "Optional execution timeout in ms" }
              },
              required: ["code"]
            }
          }
        }
      ];

      // Swarm multi-turn loop
      const messages: any[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Context: ${JSON.stringify(context.history)}\nTask: ${task.description}\nInput: ${task.input ?? ""}` }
      ];

      let turns = 0;
      const maxTurns = 5;

      while (turns < maxTurns) {
        const data = await callLLM(this.config, {
          messages,
          tools: apiTools,
          tool_choice: "auto",
          temperature: 0.1,
          max_tokens: this.maxTokens,
        });
        const msg = data.choices?.[0]?.message;
        if (!msg) throw new Error("No response message from LLM");

        messages.push(msg);

        if (msg.tool_calls && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            const toolName = tc.function.name;
            const toolArgs = JSON.parse(tc.function.arguments);

            if (onProgress) {
              onProgress(`Worker [${task.name}] executing tool [${toolName}]...`);
            }

            const toolCtx = {
              channel: "cli" as const,
              workspacePath: context.workspacePath,
              requestConsent: async () => true, // Auto consent in automated swarm worker execution
            };

            const runRes = await runTool(toolName, toolArgs, toolCtx);
            const toolOutput = runRes.success
              ? (typeof runRes.data === "string" ? runRes.data : JSON.stringify(runRes.data))
              : `Error: ${runRes.error}`;

            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              name: toolName,
              content: toolOutput,
            });
          }
          turns++;
        } else {
          task.result = msg.content || "Completed task.";
          task.status = "completed";
          break;
        }
      }

      if (task.status === "in_progress") {
        task.status = "completed";
        task.result = messages[messages.length - 1].content || "Completed task after max turns.";
      }
    } catch (err: any) {
      task.status = "failed";
      task.error = err.message || String(err);
    }

    return task;
  }
}
