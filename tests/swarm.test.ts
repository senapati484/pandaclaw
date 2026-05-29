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

    const updatedTask = await worker.run(task, context);
    expect(updatedTask.status).toBe("completed");
    expect(updatedTask.result).toBeDefined();
  });

  test("SwarmCoordinator schedules and runs fallback loop", async () => {
    const coordinator = new SwarmCoordinator(config, ".");
    
    // We pass an empty configuration api_key to force fallback templates
    const localConfig = {
      ...config,
      providers: {
        ...config.providers,
        groq: {
          ...config.providers.groq,
          api_key: "", // Force fallback since decomposition will fail
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
