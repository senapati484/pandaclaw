import { randomUUID } from "crypto";
import type {
  SessionMemory,
  LearnedConstraint,
  PlanningPattern,
  PlanningMistake
} from "./types";

export class SessionMemoryManager {
  private memory: SessionMemory;

  constructor(sessionId?: string) {
    this.memory = {
      sessionId: sessionId || randomUUID(),
      createdAt: new Date(),
      learnedConstraints: [],
      planPatterns: [],
      planningMistakes: [],
      contextCache: new Map()
    };
  }

  /**
   * Record a constraint discovered during planning.
   */
  addConstraint(
    type: LearnedConstraint["type"],
    value: string,
    reason: string,
    confidence: number = 0.8
  ): void {
    const existing = this.memory.learnedConstraints.find(
      (c) => c.type === type && c.value === value
    );

    if (existing) {
      existing.confidence = Math.min(1, existing.confidence + 0.1);
      existing.reason = reason;
    } else {
      this.memory.learnedConstraints.push({
        type,
        value,
        reason,
        confidence
      });
    }
  }

  /**
   * Record a planning pattern template.
   */
  recordPlanPattern(name: string, steps: string[], category: string, success: boolean = true): void {
    this.memory.planPatterns.push({
      name,
      steps,
      category,
      success
    });
  }

  /**
   * Get successful plan templates for a category.
   */
  getPlanPatterns(category: string): PlanningPattern[] {
    return this.memory.planPatterns.filter((p) => p.category === category && p.success);
  }

  /**
   * Record a planning mistake and its lesson.
   */
  recordPlanningMistake(description: string, lesson: string): void {
    this.memory.planningMistakes.push({
      description,
      lesson
    });
  }

  /**
   * Export the memory.
   */
  export(): SessionMemory {
    return {
      ...this.memory,
      contextCache: new Map(this.memory.contextCache)
    };
  }

  /**
   * Import memory state.
   */
  import(data: Partial<SessionMemory>): void {
    if (data.learnedConstraints) this.memory.learnedConstraints = data.learnedConstraints;
    if (data.planPatterns) this.memory.planPatterns = data.planPatterns;
    if (data.planningMistakes) this.memory.planningMistakes = data.planningMistakes;
    if (data.contextCache) this.memory.contextCache = new Map(data.contextCache);
  }

  /**
   * Get statistics summary.
   */
  getSummary(): object {
    return {
      sessionId: this.memory.sessionId,
      createdAt: this.memory.createdAt,
      constraintCount: this.memory.learnedConstraints.length,
      planPatternCount: this.memory.planPatterns.length,
      planningMistakeCount: this.memory.planningMistakes.length,
      cachedContextCount: this.memory.contextCache.size
    };
  }
}
