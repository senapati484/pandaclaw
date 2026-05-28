import type { LanguageModel } from "ai";

// ============ Action & Mutation Types ============

export type ActionType =
  | "file_create"
  | "file_modify"
  | "file_delete"
  | "folder_create"
  | "folder_delete"
  | "code_analysis"
  | "tool_execute"
  | "shell_command";

export type ActionStatus = "pending" | "executed" | "approved" | "rejected" | "failed";

export type MutationType = Extract<
  ActionType,
  "file_create" | "file_modify" | "file_delete" | "folder_create" | "folder_delete" | "shell_command"
>;

export interface ActionLog {
  id: string;
  timestamp: Date;
  type: ActionType;
  path: string;
  details: {
    before?: string;
    after?: string;
    toolName?: string;
    toolResults?: string;
    error?: string;
    command?: string;
    reasoning?: string;
  };
  status: ActionStatus;
  userApproved: boolean;
  isMutation: boolean;
}

// ============ Model & LLM Types ============

export type ModelProvider = "groq" | "openrouter";

export type ModelTaskType = "planning" | "coding" | "analysis" | "reflection";

export interface ModelConfig {
  provider: ModelProvider;
  modelId: string;
  taskType: ModelTaskType;
  temperature?: number;
  maxTokens?: number;
  rateLimit?: number;
}

export interface LLMResponse {
  content: string;
  tokensUsed: number;
  provider: ModelProvider;
}

// ============ Codebase Context Types ============

export interface FileInfo {
  path: string;
  size: number;
  type: "file" | "folder";
  language?: string;
  imports?: string[];
  exports?: string[];
  isIgnored: boolean;
}

export interface CodebaseIndex {
  files: Map<string, FileInfo>;
  folders: Map<string, FileInfo>;
  imports: Map<string, string[]>; // file -> list of files it imports
  exports: Map<string, string[]>; // file -> list of exports
  frameworks: string[]; // detected (React, Node, Bun, etc)
  patterns: string[]; // naming patterns observed
  lastUpdated: Date;
}

export interface CachedFile {
  path: string;
  content: string;
  hash: string;
  readAt: Date;
}

// ============ Session Memory Types ============

export interface LearnedConstraint {
  type: "forbidden_path" | "allowed_pattern" | "required_format" | "naming_convention";
  value: string;
  reason: string;
  confidence: number; // 0-1
}

export interface ErrorPattern {
  pattern: string;
  frequency: number;
  lastOccurred: Date;
  suggestedFix: string;
}

export interface SuccessPattern {
  description: string;
  steps: string[];
  context: string; // when to apply
}

export interface SessionMemory {
  sessionId: string;
  createdAt: Date;
  learnedConstraints: LearnedConstraint[];
  errorPatterns: Map<string, ErrorPattern>;
  contextCache: Map<string, CachedFile>;
  successPatterns: SuccessPattern[];
  actionsSinceLastReflection: number;
  reflections: ReflectionNote[];
}

export interface ReflectionNote {
  timestamp: Date;
  observation: string;
  adjustment: string;
  confidence: number;
}

// ============ Mutation & Execution Types ============

export interface MutationProposal {
  id: string;
  type: MutationType;
  path: string;
  content?: string;
  command?: string;
  rationale: string;
  estimatedRisk: "low" | "medium" | "high";
  requiresApproval: boolean;
}

export interface MutationPlan {
  steps: MutationProposal[];
  estimatedRisk: "low" | "medium" | "high";
  requiresApproval: boolean;
  totalMutations: number;
  description: string;
  dependencies: string[]; // order dependencies
}

export interface ExecutionResult {
  success: boolean;
  mutationId: string;
  output?: string;
  error?: string;
  executedAt: Date;
}

// ============ Reflection & Validation Types ============

export interface ValidationResult {
  valid: boolean;
  matches_intent: boolean;
  issues: string[];
  suggestions: string[];
}

export interface ReflectionResult {
  succeeded: boolean;
  observation: string;
  suggestedNextStep?: string;
  shouldRetry: boolean;
  confidence: number; // 0-1
}

// ============ Reactor Session Types ============

export interface ReactorSession {
  id: string;
  goal: string;
  createdAt: Date;
  modelConfigs: Map<ModelTaskType, ModelConfig>;
  codebaseIndex: CodebaseIndex;
  actionHistory: ActionLog[];
  sessionMemory: SessionMemory;
  isRunning: boolean;
  iterationCount: number;
  maxIterations: number;
  config: AgentConfig;
}

export interface AgentConfig {
  codebasePath: string;
  maxFileSizeToRead: number;
  autoExecutePaths: string[];
  askFirstPaths: string[];
  askFirstPatterns: string[];
  tools: {
    allowShellExecution: boolean;
    allowFileModification: boolean;
    allowFileCreation: boolean;
    allowFolderCreation: boolean;
  };
  approvalThresholds: {
    autoExecuteMutationLimit: number; // mutations before asking
    autoExecuteFileSizeLimit: number; // file size in bytes
    alwaysAskFor: MutationType[]; // always ask for these
  };
}

// ============ Helper Functions ============

export function isMutationType(t: ActionType): t is MutationType {
  return ["file_create", "file_modify", "file_delete", "folder_create", "folder_delete", "shell_command"].includes(t);
}

export function estimateMutationRisk(
  mutation: MutationProposal,
  config: AgentConfig
): "low" | "medium" | "high" {
  // High risk
  if (config.approvalThresholds.alwaysAskFor.includes(mutation.type)) {
    return "high";
  }

  // Check if it's in an ask-first path
  for (const pattern of config.askFirstPatterns) {
    if (mutation.path.includes(pattern)) {
      return "high";
    }
  }

  // Deletion is always risky
  if (mutation.type === "file_delete" || mutation.type === "folder_delete") {
    return "high";
  }

  // Shell commands are medium-high
  if (mutation.type === "shell_command") {
    return "high";
  }

  // Large file creation/modification is medium
  if ((mutation.content?.length || 0) > config.approvalThresholds.autoExecuteFileSizeLimit) {
    return "medium";
  }

  return "low";
}

export function defaultAgentConfig(): AgentConfig {
  return {
    codebasePath: process.cwd(),
    maxFileSizeToRead: 1024 * 1024, // 1MB
    autoExecutePaths: ["src/", "tests/", "modes/"],
    askFirstPaths: [".env", "package.json", "tsconfig.json"],
    askFirstPatterns: [".env", ".git", ".github", "node_modules"],
    tools: {
      allowShellExecution: false,
      allowFileModification: true,
      allowFileCreation: true,
      allowFolderCreation: true,
    },
    approvalThresholds: {
      autoExecuteMutationLimit: 5,
      autoExecuteFileSizeLimit: 50 * 1024, // 50KB
      alwaysAskFor: ["file_delete", "folder_delete", "shell_command"],
    },
  };
}