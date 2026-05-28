import { randomUUID } from "crypto";
import type {
  SessionMemory,
  LearnedConstraint,
  ErrorPattern,
  SuccessPattern,
  ReflectionNote,
  CachedFile,
} from "./types";

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
   * Add a learned constraint (e.g., don't modify this file)
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
        confidence,
      });
    }
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
   * Get suggestions for a frequently occurring error
   */
  getErrorSuggestion(pattern: string): string | null {
    return this.memory.errorPatterns.get(pattern)?.suggestedFix || null;
  }

  /**
   * Record a successful approach for future reference
   */
  recordSuccessPattern(
    description: string,
    steps: string[],
    context: string
  ): void {
    this.memory.successPatterns.push({
      description,
      steps,
      context,
    });
  }

  /**
   * Cache a file for quick access
   */
  cacheFile(path: string, content: string, hash: string): void {
    this.memory.contextCache.set(path, {
      path,
      content,
      hash,
      readAt: new Date(),
    });
  }

  /**
   * Get cached file if it exists
   */
  getCachedFile(path: string): CachedFile | null {
    return this.memory.contextCache.get(path) || null;
  }

  /**
   * Clear old cache entries (older than maxAge ms)
   */
  cleanCache(maxAge: number = 5 * 60 * 1000): void {
    // 5 minutes default
    const now = new Date();
    const toDelete: string[] = [];

    this.memory.contextCache.forEach((file, path) => {
      if (now.getTime() - file.readAt.getTime() > maxAge) {
        toDelete.push(path);
      }
    });

    toDelete.forEach((path) => this.memory.contextCache.delete(path));
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
   * Increment action count since last reflection
   */
  incrementActionsSinceReflection(): void {
    this.memory.actionsSinceLastReflection++;
  }

  /**
   * Get constraints of a specific type
   */
  getConstraints(type?: LearnedConstraint["type"]): LearnedConstraint[] {
    if (!type) return this.memory.learnedConstraints;
    return this.memory.learnedConstraints.filter((c) => c.type === type);
  }

  /**
   * Check if a path violates any constraints
   */
  violatesConstraints(path: string): LearnedConstraint | null {
    for (const constraint of this.memory.learnedConstraints) {
      if (constraint.type === "forbidden_path" && path.includes(constraint.value)) {
        return constraint;
      }
    }
    return null;
  }

  /**
   * Get top error patterns by frequency
   */
  getTopErrorPatterns(limit: number = 5): ErrorPattern[] {
    return Array.from(this.memory.errorPatterns.values())
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, limit);
  }

  /**
   * Get relevant success patterns for a context
   */
  getSuccessPatternsFor(context: string): SuccessPattern[] {
    return this.memory.successPatterns.filter((p) =>
      p.context.toLowerCase().includes(context.toLowerCase())
    );
  }

  /**
   * Get recent reflections
   */
  getRecentReflections(limit: number = 5): ReflectionNote[] {
    return this.memory.reflections.slice(-limit);
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

  /**
   * Get memory summary for debugging
   */
  getSummary(): object {
    return {
      sessionId: this.memory.sessionId,
      createdAt: this.memory.createdAt,
      constraintCount: this.memory.learnedConstraints.length,
      errorPatternCount: this.memory.errorPatterns.size,
      cachedFileCount: this.memory.contextCache.size,
      successPatternCount: this.memory.successPatterns.length,
      reflectionCount: this.memory.reflections.length,
      actionsSinceReflection: this.memory.actionsSinceLastReflection,
    };
  }
}
