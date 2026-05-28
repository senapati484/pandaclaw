export type PlanStatus = "draft" | "validated" | "approved" | "in-progress" | "completed" | "abandoned";
export type RiskLevel = "low" | "medium" | "high";
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
}

export interface LearnedConstraint {
  type: "forbidden_path" | "allowed_pattern" | "required_format" | "naming_convention";
  value: string;
  reason: string;
  confidence: number;
}

export interface PlanningPattern {
  name: string;
  steps: string[];
  category: string;
  success: boolean;
}

export interface PlanningMistake {
  description: string;
  lesson: string;
}

export interface SessionMemory {
  sessionId: string;
  createdAt: Date;
  learnedConstraints: LearnedConstraint[];
  planPatterns: PlanningPattern[];
  planningMistakes: PlanningMistake[];
  contextCache: Map<string, any>;
}
