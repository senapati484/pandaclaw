import type { SwarmTask, SwarmContext, SwarmWorkerType } from "./types.js";
import type { PandaConfig } from "../../../ai/ai.config.js";
import { runTool } from "../../../tools/index.js";

export class SwarmWorker {
  private type: SwarmWorkerType;
  private config: PandaConfig;

  constructor(type: SwarmWorkerType, config: PandaConfig) {
    this.type = type;
    this.config = config;
  }

  public async run(task: SwarmTask, context: SwarmContext): Promise<SwarmTask> {
    task.status = "in_progress";

    try {
      const apiKey = this.config.providers.groq.api_key;
      if (!apiKey) {
        throw new Error("Missing Groq API Key");
      }

      let systemPrompt = "";
      switch (this.type) {
        case "researcher":
          systemPrompt = `You are a researcher worker agent in a PandaClaw swarm.
Your goal is to gather facts, search the web, read files, or analyze data.
Stay factual. Focus purely on gathering accurate details.`;
          break;
        case "coder":
          systemPrompt = `You are a coding specialist worker agent in a PandaClaw swarm.
Your goal is to implement, edit, or create files, and write logic.
Output precise code modifications. Follow instructions exactly.`;
          break;
        case "verifier":
          systemPrompt = `You are a verification specialist worker agent in a PandaClaw swarm.
Your goal is to check correctness, sanity check files, run tests, and critique outputs.
Output VERDICT: PASS or list structural faults.`;
          break;
        case "visualizer":
          systemPrompt = `You are a visual design worker agent in a PandaClaw swarm.
Your goal is to locate coordinate details, format reports, or outline mockups.`;
          break;
      }

      // Check if task description asks for specific tools
      let toolToRun: string | null = null;
      let toolArgs: Record<string, unknown> = {};

      const descLower = task.description.toLowerCase();

      if (descLower.includes("web_search") || (descLower.includes("search for") && !descLower.includes("file"))) {
        toolToRun = "web_search";
        const qMatch = task.description.match(/query:\s*"([^"]+)"/i) || task.description.match(/search for\s*(.+)/i);
        toolArgs = { query: qMatch && qMatch[1] ? qMatch[1].trim() : task.description };
      } else if (descLower.includes("file_read") || descLower.includes("read file")) {
        toolToRun = "file_read";
        const pathMatch = task.description.match(/path:\s*"([^"]+)"/i) || task.description.match(/file:\s*"([^"]+)"/i) || task.description.match(/read\s+([^\s]+)/i);
        toolArgs = { path: pathMatch && pathMatch[1] ? pathMatch[1].trim() : "" };
      } else if (descLower.includes("file_write") || descLower.includes("write file")) {
        toolToRun = "file_write";
        const pathMatch = task.description.match(/path:\s*"([^"]+)"/i) || task.description.match(/file:\s*"([^"]+)"/i);
        const contentMatch = task.description.match(/content:\s*"([\s\S]+)"/i);
        toolArgs = {
          path: pathMatch && pathMatch[1] ? pathMatch[1].trim() : "",
          content: contentMatch && contentMatch[1] ? contentMatch[1] : "",
        };
      } else if (descLower.includes("code_exec") || descLower.includes("execute code")) {
        toolToRun = "code_exec";
        const codeMatch = task.description.match(/code:\s*"([\s\S]+)"/i) || task.description.match(/run:\s*([\s\S]+)/i);
        toolArgs = { code: codeMatch && codeMatch[1] ? codeMatch[1].trim() : "" };
      }

      if (toolToRun) {
        const toolCtx = {
          channel: "cli" as const,
          workspacePath: context.workspacePath,
          requestConsent: async () => true, // Auto consent in automated swarm worker execution
        };
        const runRes = await runTool(toolToRun, toolArgs, toolCtx);
        if (runRes.success) {
          task.status = "completed";
          task.result = typeof runRes.data === "string" ? runRes.data : JSON.stringify(runRes.data, null, 2);
        } else {
          task.status = "failed";
          task.error = runRes.error;
        }
      } else {
        const res = await fetch(`${this.config.providers.groq.api_base}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: this.config.routing.fast_path.model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `Context: ${JSON.stringify(context.history)}\nTask: ${task.description}\nInput: ${task.input ?? ""}` },
            ],
            max_tokens: 1024,
            temperature: 0.2,
          }),
        });

        if (!res.ok) throw new Error(`Groq API returned ${res.status}`);
        const data = (await res.json()) as any;
        task.result = data.choices[0]?.message?.content ?? "";
        task.status = "completed";
      }
    } catch (err: any) {
      task.status = "failed";
      task.error = err.message || String(err);
    }

    return task;
  }
}
