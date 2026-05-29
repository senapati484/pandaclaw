import type { SwarmTask, SwarmContext, SwarmWorkerType } from "./types.js";
import type { PandaConfig } from "../../../ai/ai.config.js";
import { runTool } from "../../../tools/index.js";
import { callLLM } from "../../../ai/llm.js";
import chalk from "chalk";

export class SwarmWorker {
  private type: SwarmWorkerType;
  private config: PandaConfig;

  constructor(type: SwarmWorkerType, config: PandaConfig) {
    this.type = type;
    this.config = config;
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
Your goal is to implement, edit, or create files, and write logic.
You have tools to write files, read files, list directories, and execute code.
CRITICAL: Before writing or modifying any file, you must first read its existing content (if it exists) to ensure your changes integrate seamlessly without breaking existing functionality. Check your changes for correctness.`;
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
