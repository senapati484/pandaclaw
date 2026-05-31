// modes/agent/types.ts

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

export type ModelProvider = "groq" | "openrouter" | "nvidia_nim";

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

import { readConfig } from "../../ai/ai.config.js";

export function defaultAgentConfig(): AgentConfig {
  let userConfig: any = {};
  try {
    userConfig = readConfig();
  } catch {
    // Ignore config read failures
  }

  const agentConfig = userConfig.agent || {};
  const toolsConfig = agentConfig.tools || {};

  return {
    codebasePath: process.cwd(),
    maxFileSizeToRead: 1024 * 1024, // 1MB
    autoExecutePaths: agentConfig.autoExecutePaths || ["src/", "tests/", "modes/"],
    askFirstPaths: agentConfig.askFirstPaths || [".env", "package.json", "tsconfig.json"],
    askFirstPatterns: agentConfig.askFirstPatterns || [".env", ".git", ".github", "node_modules"],
    tools: {
      allowShellExecution: toolsConfig.allowShellExecution ?? true,
      allowFileModification: toolsConfig.allowFileModification ?? true,
      allowFileCreation: toolsConfig.allowFileCreation ?? true,
      allowFolderCreation: toolsConfig.allowFolderCreation ?? true,
    },
    approvalThresholds: {
      autoExecuteMutationLimit: agentConfig.approvalThresholds?.autoExecuteMutationLimit ?? 5,
      autoExecuteFileSizeLimit: agentConfig.approvalThresholds?.autoExecuteFileSizeLimit ?? 50 * 1024,
      alwaysAskFor: agentConfig.approvalThresholds?.alwaysAskFor ?? ["file_delete", "folder_delete", "shell_command"],
    },
  };
}

// ============ Vision Types ============

export type VisionContentType =
  | "screenshot"
  | "document"
  | "chart"
  | "code"
  | "general";

export interface SpatialElement {
  type: string;
  label?: string;
  text?: string;
  position?: { x: number; y: number; w?: number; h?: number };
  confidence: number;
}

export interface CodeFinding {
  line?: number;
  severity: "error" | "warning" | "info";
  message: string;
  fix?: string;
}

export type VisionAction =
  | { type: "describe"; summary: string }
  | { type: "extract"; data: Record<string, unknown> }
  | { type: "diagnose"; issue: string; fix: string }
  | { type: "navigate"; instruction: string }
  | { type: "code_review"; findings: CodeFinding[] };

export interface VisionResult {
  contentType: VisionContentType;
  elements: SpatialElement[];
  reasoning: string;
  action: VisionAction;
  modelUsed: string;
}

// ============ Ask Mode Types ============

export type AskTaskType = "simple" | "complex" | "vision";

export interface AskTask {
  id: string;
  type: AskTaskType;
  input: string;
  images?: Buffer[];
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  createdAt: Date;
}

export interface AskResult {
  answer: string;
  taskType: AskTaskType;
  tokensUsed: number;
  provider: ModelProvider;
  durationMs: number;
  verified: boolean;
}

// ============ Plan Mode Types ============

export interface PlanStep {
  index: number;
  title: string;
  description: string;
  tool?: string | null;
  toolArgs?: Record<string, unknown> | null;
  dependsOn?: number[];
  status: "pending" | "running" | "done" | "skipped" | "failed";
  result?: string;
}

export interface Plan {
  id: string;
  goal: string;
  steps: PlanStep[];
  estimatedComplexity: "low" | "medium" | "high";
  createdAt: Date;
}

export interface PlanExecutionResult {
  planId: string;
  goal: string;
  finalAnswer: string;
  stepsCompleted: number;
  stepsFailed: number;
  verified: boolean;
  durationMs: number;
}

// ============ Tool Types ============

export interface ToolContext {
  userId?: string;
  channel: "cli" | "telegram" | "discord" | "web";
  requestConsent: (tool: string, preview: string) => Promise<boolean>;
  workspacePath: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  risky: boolean;
  readOnly: boolean;
  schema?: any;
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<unknown>;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ============ Memory Types ============

export interface MemoryEntry {
  id: string;
  timestamp: number;
  role: "user" | "assistant";
  content: string;
  summary?: string;
  tags?: string[];
  importance: "low" | "medium" | "high";
}

export interface PersistentMemory {
  sessionCount: number;
  lastSeen: number;
  userPreferences: Record<string, string>;
  recentEntries: MemoryEntry[];
  longTermFacts: MemoryEntry[];
}