export type RiskLevel = "low" | "medium" | "high";

export interface LearnedConstraint {
  type: "forbidden_path" | "allowed_pattern" | "required_format" | "naming_convention";
  value: string;
  reason: string;
  confidence: number;
}
