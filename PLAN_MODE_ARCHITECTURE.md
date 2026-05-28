# Plan Mode Architecture

## Overview

**Plan Mode** is a Strategic Planning system that generates, validates, optimizes, and tracks execution plans for complex project goals. It operates independently or in coordination with Agent Mode to provide comprehensive planning capabilities before execution begins.

## Architecture

### Core Components (Mirroring Agent Mode Structure)

#### 1. **Model Selector** (`plan/model-selector.ts`)
- Auto-selects best model based on planning task type
- Prioritizes models with strong reasoning capabilities
- Caches model selection per planning task type

**Models:**
- **Groq (Preferred):**
  - Planning: Mixtral 8x7B (structured planning)
  - Analysis: Llama 3 70B (complex reasoning & validation)
  - Optimization: Mixtral 8x7B (plan refinement)
- **OpenRouter (Fallback):**
  - Planning: Claude 3 Sonnet
  - Analysis: Claude 3 Opus
  - Optimization: Claude 3 Sonnet

#### 2. **Codebase Context Manager** (`plan/context-manager.ts`)
- **Reuses:** `modes/agent/context-manager.ts` or creates lightweight alias
- Provides codebase structure for plan generation
- Analyzes existing patterns and conventions
- Detects dependencies and relationships
- Caches analysis results for plan validation

#### 3. **Session Memory Manager** (`plan/session-memory.ts`)
- Stores session-scoped learning during planning phase
- Tracks successful planning patterns
- Records failed planning approaches and learnings
- Maintains planning context and decision history
- Provides reflection history for plan iterations

**Memory Types:**
- Planning Patterns: Reusable planning templates
- Constraint Assumptions: Known project constraints
- Risk Profiles: Common risks and mitigations
- Success Criteria: Successful plan outcomes
- Planning Context: Decision rationale and trade-offs

#### 4. **Plan Tracker** (`plan/plan-tracker.ts`)
- Logs all plan versions and iterations
- Tracks plan status (draft, validated, approved, in-progress, completed)
- Differentiates between planning phases (preparation, generation, validation, optimization)
- Provides plan history and statistics
- Enables plan comparison and rollback

**Tracked Elements:**
- Plan versions with timestamps
- Modification history
- Validation results
- Approval chain
- Execution progress mapping

#### 5. **Plan Generator** (`plan/plan-generator.ts`)
- Generates initial plans from goals and context
- Creates structured task breakdown
- Identifies dependencies and ordering
- Estimates effort, risk, and timeline
- Generates multiple plan alternatives

**Plan Generation Patterns:**
- Feature Implementation Plans
- Refactoring Plans
- Bug Fix Plans
- Architecture Migration Plans
- Optimization Plans

#### 6. **Plan Validator** (`plan/plan-validator.ts`)
- Validates plan feasibility
- Checks for circular dependencies
- Verifies coverage of all requirements
- Assesses risk levels
- Validates against learned constraints
- Identifies gaps and inconsistencies

**Validation Checks:**
- Dependency validation
- Resource availability
- Feasibility assessment
- Constraint compliance
- Risk assessment
- Coverage analysis

#### 7. **Plan Optimizer** (`plan/plan-optimizer.ts`)
- Refines plans for efficiency
- Parallelizes independent tasks
- Reduces critical path length
- Minimizes resource conflicts
- Balances risk vs. speed
- Suggests alternative approaches

**Optimization Strategies:**
- Critical path analysis
- Task parallelization
- Dependency reduction
- Resource optimization
- Risk mitigation strategies

#### 8. **Plan Orchestrator** (`plan/orchestrator.ts`)
- Manages the planning lifecycle
- Coordinates all components
- Implements the 6-phase planning pattern

### Planning Phases

```
1. UNDERSTAND
   └─ Analyze goal and context
   └─ Extract requirements
   └─ Identify constraints and risks

2. GENERATE
   └─ Create initial plan(s)
   └─ Break down into tasks
   └─ Analyze dependencies

3. VALIDATE
   └─ Check feasibility
   └─ Verify coverage
   └─ Assess risks
   └─ Validate constraints

4. OPTIMIZE
   └─ Improve efficiency
   └─ Parallelize tasks
   └─ Reduce timeline
   └─ Suggest alternatives

5. COMMUNICATE
   └─ Generate plan documentation
   └─ Create execution brief
   └─ Output task checklist
   └─ Provide decision rationale

6. EXECUTE/MONITOR
   └─ Export plan to Agent Mode
   └─ Track execution progress
   └─ Adapt plan as needed
```

## File Structure

```
modes/plan/
  ├── model-selector.ts           # AI model selection for planning
  ├── context-manager.ts          # Lightweight codebase context
  ├── session-memory.ts           # Planning session learning
  ├── plan-tracker.ts             # Plan versioning and history
  ├── plan-generator.ts           # Generate initial plans
  ├── plan-validator.ts           # Validate plan feasibility
  ├── plan-optimizer.ts           # Optimize for efficiency
  ├── orchestrator.ts             # Coordinate planning phases
  ├── types.ts                    # TypeScript types and interfaces
  ├── plan.test.ts                # Comprehensive test suite
  └── README.md                   # Architecture documentation
```

## Integration Points

### With Agent Mode
- **Import Plans:** Agent Mode imports validated plans for execution
- **Feedback Loop:** Execution results feed back to Plan Mode for iteration
- **Shared Memory:** Learning shared between modes
- **Shared Context:** Codebase context used by both modes

### External Integration
- **CLI Mode:** Plan generation triggered from CLI
- **Git Integration:** Export plans as commits, branches
- **Documentation:** Generate plan documentation
- **Reporting:** Track plan execution and outcomes

## Types Definition

### Core Types (`plan/types.ts`)
```typescript
interface Plan {
  id: string;
  goal: string;
  description: string;
  status: PlanStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  
  tasks: Task[];
  dependencies: Dependency[];
  estimatedEffort: number; // hours
  estimatedRisk: RiskLevel;
  alternatives?: Plan[];
  validation?: ValidationResult;
  metadata: Record<string, any>;
}

interface Task {
  id: string;
  description: string;
  type: TaskType;
  effort: number;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  dependencies: string[]; // Task IDs
  successCriteria: string[];
  notes?: string;
}

interface Dependency {
  taskId: string;
  dependsOn: string[];
  type: "blocking" | "suggests" | "conflicts";
}

type PlanStatus = "draft" | "validated" | "approved" | "in-progress" | "completed" | "abandoned";
type RiskLevel = "low" | "medium" | "high";
type TaskType = "analysis" | "create" | "modify" | "delete" | "test" | "review" | "refactor";
```

## Key Features

1. **Multi-Alternative Planning:** Generate and compare multiple plan approaches
2. **Dependency Analysis:** Automatic detection and visualization of task dependencies
3. **Risk Assessment:** Comprehensive risk evaluation with mitigation strategies
4. **Constraint Validation:** Verify plans against project constraints
5. **Timeline Optimization:** Minimize critical path and suggest parallelization
6. **Decision Rationale:** Track why decisions were made during planning
7. **Plan Iteration:** Learn from execution results and improve future plans
8. **Documentation Export:** Generate comprehensive plan documentation

## Testing Strategy

The plan mode will follow the same testing patterns as agent mode:
- Unit tests for each component
- Integration tests for orchestrator
- Mock codebase scenarios
- Plan generation and validation tests
- Optimization strategy tests
- Edge case coverage

## Success Criteria

- [ ] All components implemented and tested
- [ ] Plans can be generated from complex goals
- [ ] Validation catches feasibility issues
- [ ] Optimization reduces timeline by 20%+
- [ ] Plans successfully execute via Agent Mode
- [ ] Learning improves future planning
- [ ] Documentation is auto-generated accurately
