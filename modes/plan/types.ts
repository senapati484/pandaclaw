import type { RiskLevel as SharedRiskLevel } from "../../types/shared.js";
export type RiskLevel = SharedRiskLevel;

export type PlanStatus = "draft" | "validated" | "approved" | "in-progress" | "completed" | "abandoned";
export type TaskType = "analysis" | "create" | "modify" | "delete" | "test" | "review" | "refactor";

export interface Task {
  id: string;
  description: string;
  type: TaskType;
  effort: number; // in hours
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  dependencies: string[]; // task IDs
  successCriteria: string[];
  notes?: string;
}

export interface Dependency {
  taskId: string;
  dependsOn: string[];
  type: "blocking" | "suggests" | "conflicts";
}

export interface ValidationResult {
  valid: boolean;
  issues: string[];
  warnings: string[];
}

export interface OptimizationResult {
  originalEffort: number;
  optimizedEffort: number;
  parallelGroups: string[][]; // Levels of tasks that can run in parallel
  criticalPath: string[];
}

export interface Plan {
  id: string;
  goal: string;
  description: string;
  status: PlanStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  tasks: Task[];
  dependencies: Dependency[];
  estimatedEffort: number;
  estimatedRisk: RiskLevel;
  validation?: ValidationResult;
  optimization?: OptimizationResult;
  metadata?: Record<string, unknown>;
}

import type { LearnedConstraint } from "../../types/shared.js";

interface PlanningPattern {
  name: string;
  steps: string[];
  category: string;
  success: boolean;
}

interface PlanningMistake {
  description: string;
  lesson: string;
}

interface SessionMemory {
  sessionId: string;
  createdAt: Date;
  learnedConstraints: LearnedConstraint[];
  planPatterns: PlanningPattern[];
  planningMistakes: PlanningMistake[];
  contextCache: Map<string, any>;
}
