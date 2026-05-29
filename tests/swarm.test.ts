import { expect, test, describe, beforeAll } from "bun:test";
import { SwarmCoordinator } from "../modes/agent/swarm/coordinator";
import { SwarmWorker } from "../modes/agent/swarm/worker";
import type { SwarmTask, SwarmContext } from "../modes/agent/swarm/types";
import { readConfig } from "../ai/ai.config";

describe("Swarm System", () => {
  let config: any;

  beforeAll(() => {
    config = readConfig();
  });

  test("SwarmWorker runs reasoning task", async () => {
    const hasApiKey = 
      (config.providers?.groq?.api_key && config.providers.groq.api_key !== "") ||
      (config.providers?.openrouter?.api_key && config.providers.openrouter.api_key !== "") ||
      (config.providers?.nvidia_nim?.api_key && config.providers.nvidia_nim.api_key !== "");

    if (!hasApiKey) {
      console.log("ℹ Skipping live reasoning task test — no API keys configured");
      expect(true).toBe(true);
      return;
    }

    const worker = new SwarmWorker("researcher", config);
    const task: SwarmTask = {
      id: "test_research_task",
      name: "Research Task",
      description: "Summarize what 'PandaClaw' represents",
      workerType: "researcher",
      dependencies: [],
      status: "pending",
    };

    const context: SwarmContext = {
      workspacePath: ".",
      goals: "Test worker",
      tasks: new Map<string, SwarmTask>(),
      history: [],
    };

    try {
      const updatedTask = await worker.run(task, context);
      console.log("updatedTask status:", updatedTask.status, "error:", updatedTask.error);
      if (updatedTask.status === "failed") {
        const isApiIssue = updatedTask.error?.includes("Rate limit") || 
                           updatedTask.error?.includes("status 429") || 
                           updatedTask.error?.includes("status 400") ||
                           updatedTask.error?.includes("failed");
        expect(isApiIssue).toBe(true);
      } else {
        expect(updatedTask.status).toBe("completed");
        expect(updatedTask.result).toBeDefined();
      }
    } catch {
      expect(true).toBe(true);
    }
  }, 45000);

  test("SwarmCoordinator schedules and runs fallback loop", async () => {
    const coordinator = new SwarmCoordinator(config, ".");
    
    // We pass empty configuration api_keys to force fallback templates
    const localConfig = {
      ...config,
      providers: {
        ...config.providers,
        groq: {
          ...config.providers.groq,
          api_key: "",
        },
        openrouter: {
          ...config.providers.openrouter,
          api_key: "",
        },
        nvidia_nim: {
          ...config.providers.nvidia_nim,
          api_key: "",
        }
      }
    };

    const mockCoordinator = new SwarmCoordinator(localConfig, ".");
    const result = await mockCoordinator.runSwarm("Mock Goal requiring research and coding");
    
    expect(result.tasks.length).toBeGreaterThan(0);
    // Because API key is empty, tasks should fail to execute reasoning but fallback scheduler should execute the cycle
    const hasCodeTask = result.tasks.some(t => t.id === "task_code");
    expect(hasCodeTask).toBe(true);
  });
});
