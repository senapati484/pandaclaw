import { randomUUID } from "crypto";
import type { SessionMemory, ErrorPattern, SuccessPattern, LearnedConstraint } from "./types";

export class SessionMemoryManager {
  private memory: SessionMemory;

  constructor(sessionId?: string) {
    this.memory = {
      sessionId: sessionId || randomUUID(),
      createdAt: new Date(),
      learnedConstraints: [],
      errorPatterns: new Map(),
      contextCache: new Map(),
      successPatterns: [],
      actionsSinceLastReflection: 0,
      reflections: [],
    };
  }

  /**
   * Record an error pattern for learning
   */
  recordError(pattern: string, suggestedFix: string): void {
    const existing = this.memory.errorPatterns.get(pattern);

    if (existing) {
      existing.frequency++;
      existing.lastOccurred = new Date();
    } else {
      this.memory.errorPatterns.set(pattern, {
        pattern,
        frequency: 1,
        lastOccurred: new Date(),
        suggestedFix,
      });
    }
  }

  /**
   * Get top error patterns sorted by frequency
   */
  getTopErrorPatterns(limit: number): ErrorPattern[] {
    return Array.from(this.memory.errorPatterns.values())
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, limit);
  }

  /**
   * Add a learned constraint
   */
  addConstraint(
    type: "forbidden_path" | "allowed_pattern" | "required_format" | "naming_convention",
    value: string,
    reason: string,
    confidence: number = 1.0
  ): void {
    this.memory.learnedConstraints.push({
      type,
      value,
      reason,
      confidence,
    });
  }

  /**
   * Get learned constraints, optionally filtered by type
   */
  getConstraints(type?: string): LearnedConstraint[] {
    if (type) {
      return this.memory.learnedConstraints.filter((c) => c.type === type);
    }
    return this.memory.learnedConstraints;
  }

  /**
   * Check if a path violates any constraints
   */
  violatesConstraints(path: string): LearnedConstraint | null {
    for (const c of this.memory.learnedConstraints) {
      if (c.type === "forbidden_path" && path.includes(c.value)) {
        return c;
      }
    }
    return null;
  }

  /**
   * Record a successful sequence of steps for a context
   */
  recordSuccessPattern(description: string, steps: string[], context: string): void {
    this.memory.successPatterns.push({
      description,
      steps,
      context,
    });
  }

  /**
   * Get success patterns for a specific context
   */
  getSuccessPatternsFor(context: string): SuccessPattern[] {
    return this.memory.successPatterns.filter((p) => p.context === context);
  }

  /**
   * Record a reflection for learning
   */
  addReflection(observation: string, adjustment: string, confidence: number = 0.7): void {
    this.memory.reflections.push({
      timestamp: new Date(),
      observation,
      adjustment,
      confidence,
    });
    this.memory.actionsSinceLastReflection = 0;
  }

  /**
   * Export memory state (for persistence/debugging)
   */
  export(): SessionMemory {
    return {
      ...this.memory,
      errorPatterns: new Map(this.memory.errorPatterns),
      contextCache: new Map(this.memory.contextCache),
    };
  }

  /**
   * Import memory state (for restoration)
   */
  import(data: Partial<SessionMemory>): void {
    if (data.learnedConstraints)
      this.memory.learnedConstraints = data.learnedConstraints;
    if (data.errorPatterns)
      this.memory.errorPatterns = new Map(data.errorPatterns);
    if (data.contextCache)
      this.memory.contextCache = new Map(data.contextCache);
    if (data.successPatterns)
      this.memory.successPatterns = data.successPatterns;
    if (data.reflections)
      this.memory.reflections = data.reflections;
  }
}
