import { generateText } from "ai";
import type { ModelConfig, ModelTaskType, LLMResponse } from "./types";

const GROQ_MODELS = {
  fast: "mixtral-8x7b-32768", // Good balance, 32k context
  coding: "mixtral-8x7b-32768", // Better for code
  analysis: "llama-3-70b-8192", // Stronger analysis
};

const OPENROUTER_MODELS = {
  fast: "mistralai/mistral-7b-instruct",
  coding: "meta-llama/codellama-34b-instruct",
  analysis: "meta-llama/llama-3-70b-instruct",
};

export class ModelSelector {
  private groqApiKey: string;
  private openrouterApiKey: string;
  private modelCache: Map<ModelTaskType, ModelConfig> = new Map();

  constructor() {
    this.groqApiKey = process.env.GROQ_API_KEY || "";
    this.openrouterApiKey = process.env.OPENROUTER_API_KEY || "";
  }

  /**
   * Auto-select best model based on task type and availability
   * Prioritizes Groq (free tier) unless rate-limited or unavailable
   */
  async selectModel(taskType: ModelTaskType): Promise<ModelConfig> {
    // Return cached config if available
    if (this.modelCache.has(taskType)) {
      return this.modelCache.get(taskType)!;
    }

    let config: ModelConfig;

    // Try Groq first (free tier is generous)
    if (this.groqApiKey) {
      config = {
        provider: "groq",
        modelId: this.getGroqModel(taskType),
        taskType,
        temperature: taskType === "coding" ? 0.7 : 0.5,
        maxTokens: 2048,
      };

      // Test if Groq is available
      const isAvailable = await this.testModel(config);
      if (isAvailable) {
        this.modelCache.set(taskType, config);
        return config;
      }
    }

    // Fallback to OpenRouter
    if (this.openrouterApiKey) {
      config = {
        provider: "openrouter",
        modelId: this.getOpenRouterModel(taskType),
        taskType,
        temperature: taskType === "coding" ? 0.7 : 0.5,
        maxTokens: 2048,
      };

      this.modelCache.set(taskType, config);
      return config;
    }

    throw new Error("No API keys configured for Groq or OpenRouter");
  }

  private getGroqModel(taskType: ModelTaskType): string {
    const key = taskType === "coding" ? "coding" : taskType === "analysis" ? "analysis" : "fast";
    return GROQ_MODELS[key as keyof typeof GROQ_MODELS];
  }

  private getOpenRouterModel(taskType: ModelTaskType): string {
    const key = taskType === "coding" ? "coding" : taskType === "analysis" ? "analysis" : "fast";
    return OPENROUTER_MODELS[key as keyof typeof OPENROUTER_MODELS];
  }

  /**
   * Test if a model is available and responsive
   */
  private async testModel(config: ModelConfig): Promise<boolean> {
    try {
      // Don't actually call the model, just check if we have the API key
      // In production, you could send a tiny test request
      return config.provider === "groq" ? !!this.groqApiKey : !!this.openrouterApiKey;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get appropriate model config for task type
   * Recommends models based on complexity and cost
   */
  getRecommendedModel(taskType: ModelTaskType): ModelConfig {
    const cached = this.modelCache.get(taskType);
    if (cached) return cached;

    // Return a default that will be used until selectModel is called
    return {
      provider: "groq",
      modelId: this.getGroqModel(taskType),
      taskType,
      temperature: taskType === "coding" ? 0.7 : 0.5,
      maxTokens: 2048,
    };
  }

  /**
   * Clear cache to force re-selection on next call
   */
  clearCache(): void {
    this.modelCache.clear();
  }
}

export const modelSelector = new ModelSelector();
