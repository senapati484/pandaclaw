import type { Plan, PlanStatus } from "./types";

export class PlanTracker {
  private plans: Plan[] = [];
  private planIndex: Map<string, Plan> = new Map();

  /**
   * Record a new plan version or update.
   */
  recordPlan(plan: Plan): void {
    // deep clone
    const cloned = JSON.parse(JSON.stringify(plan)) as Plan;
    cloned.createdAt = new Date(plan.createdAt);
    cloned.updatedAt = new Date();

    this.plans.push(cloned);
    this.planIndex.set(cloned.id, cloned);
  }

  /**
   * Get plan by ID.
   */
  getPlan(id: string): Plan | null {
    return this.planIndex.get(id) || null;
  }

  /**
   * Get all recorded versions of a plan by goal.
   */
  getPlanHistory(goal: string): Plan[] {
    return this.plans.filter((p) => p.goal.toLowerCase() === goal.toLowerCase());
  }

  /**
   * Update the status of a plan.
   */
  trackStatusChange(planId: string, newStatus: PlanStatus, reason?: string): boolean {
    const plan = this.planIndex.get(planId);
    if (!plan) return false;

    plan.status = newStatus;
    plan.updatedAt = new Date();
    if (reason) {
      if (!plan.metadata) plan.metadata = {};
      plan.metadata.statusChangeReason = reason;
    }
    return true;
  }

  /**
   * Get summary statistics of tracked plans.
   */
  getStatistics() {
    return {
      totalPlans: this.plans.length,
      draftCount: this.plans.filter((p) => p.status === "draft").length,
      validatedCount: this.plans.filter((p) => p.status === "validated").length,
      approvedCount: this.plans.filter((p) => p.status === "approved").length,
      inProgressCount: this.plans.filter((p) => p.status === "in-progress").length,
      completedCount: this.plans.filter((p) => p.status === "completed").length,
      abandonedCount: this.plans.filter((p) => p.status === "abandoned").length
    };
  }

  export(): Plan[] {
    return JSON.parse(JSON.stringify(this.plans));
  }

  import(plans: Plan[]): void {
    this.plans = plans.map(p => ({
      ...p,
      createdAt: new Date(p.createdAt),
      updatedAt: new Date(p.updatedAt)
    }));
    this.planIndex.clear();
    this.plans.forEach(p => this.planIndex.set(p.id, p));
  }
}
