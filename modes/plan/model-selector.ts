import { generateText } from "ai";
import type { ModelConfig, ModelTaskType } from "../agent/types";

const PLANNING_MODELS = {
  planning: "llama-3.1-8b-instant",
  analysis: "llama-3.3-70b-versatile",
  optimization: "llama-3.1-8b-instant",
};

const OPENROUTER_MODELS = {
  planning: "meta-llama/llama-3.3-70b-instruct",
  analysis: "meta-llama/llama-3.3-70b-instruct",
  optimization: "meta-llama/llama-3.3-70b-instruct",
};

export class ModelSelector {
  private groqApiKey: string;
  private openrouterApiKey: string;
  private modelCache: Map<string, ModelConfig> = new Map();

  constructor() {
    this.groqApiKey = process.env.YOUR_GROQ_API_KEY || process.env.GROQ_API_KEY || "";
    this.openrouterApiKey = process.env.YOUR_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || "";
  }

  /**
   * Run the LLM request based on the selected model config
   */
  async generateText(taskType: "planning" | "analysis" | "optimization", prompt: string, systemPrompt?: string): Promise<string> {
    const config = await this.selectModel(taskType);
    let modelInstance: any;

    if (config.provider === "groq") {
      const { createGroq } = await import("@ai-sdk/groq");
      const groq = createGroq({
        apiKey: this.groqApiKey,
      });
      modelInstance = groq(config.modelId);
    } else if (config.provider === "openrouter") {
      const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
      const openrouter = createOpenRouter({
        apiKey: this.openrouterApiKey,
      });
      modelInstance = openrouter.chat(config.modelId);
    } else {
      throw new Error(`Unsupported model provider: ${config.provider}`);
    }

    const { text } = await generateText({
      model: modelInstance,
      prompt,
      system: systemPrompt,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    });

    return text;
  }

  /**
   * Select the best model based on task type.
   */
  async selectModel(taskType: "planning" | "analysis" | "optimization"): Promise<ModelConfig> {
    if (this.modelCache.has(taskType)) {
      return this.modelCache.get(taskType)!;
    }

    let config: ModelConfig;

    if (this.groqApiKey) {
      config = {
        provider: "groq",
        modelId: PLANNING_MODELS[taskType],
        taskType: taskType === "optimization" ? "reflection" : taskType === "analysis" ? "analysis" : "planning",
        temperature: 0.2,
        maxTokens: 2048,
      };
      this.modelCache.set(taskType, config);
      return config;
    }

    config = {
      provider: "openrouter",
      modelId: OPENROUTER_MODELS[taskType],
      taskType: taskType === "optimization" ? "reflection" : taskType === "analysis" ? "analysis" : "planning",
      temperature: 0.2,
      maxTokens: 2048,
    };
    this.modelCache.set(taskType, config);
    return config;
  }

  getRecommendedModel(taskType: "planning" | "analysis" | "optimization"): ModelConfig {
    const cached = this.modelCache.get(taskType);
    if (cached) return cached;

    return {
      provider: "groq",
      modelId: PLANNING_MODELS[taskType],
      taskType: taskType === "optimization" ? "reflection" : taskType === "analysis" ? "analysis" : "planning",
      temperature: 0.2,
      maxTokens: 2048,
    };
  }

  clearCache(): void {
    this.modelCache.clear();
  }
}

export const modelSelector = new ModelSelector();
