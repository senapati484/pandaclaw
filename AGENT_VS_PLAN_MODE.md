# Agent Mode vs Plan Mode: Parallel Architecture Guide

## Quick Reference: Component Mapping

| Agent Mode Component | Plan Mode Component | Purpose | Relationship |
|---|---|---|---|
| `model-selector.ts` | `model-selector.ts` | Select optimal AI model | Parallel: Different task requirements |
| `context-manager.ts` | `context-manager.ts` | Understand codebase structure | Shared/Reused: Same index used |
| `session-memory.ts` | `session-memory.ts` | Learn during session | Parallel: Different learning patterns |
| `action-tracker.ts` | `plan-tracker.ts` | Log & track items | Parallel: Track actions vs plans |
| `action-planner.ts` | `plan-generator.ts` | Create step-by-step work | Sequential: Plan → Execute |
| `reflection-engine.ts` | `plan-validator.ts` | Validate outcomes | Parallel: Validate during vs before |
| `mutation-executor.ts` | `plan-optimizer.ts` | Execute/improve work | Sequential: Optimize → Execute |
| `orchestrator.ts` | `orchestrator.ts` | Coordinate phases | Parallel: Separate lifecycles |

## Architecture Pattern Comparison

### Agent Mode (Execution-Focused)
```
Goal
  ↓
[Agent Orchestrator]
  ├─→ OBSERVE (Read codebase state)
  ├─→ REASON (Evaluate progress)
  ├─→ PLAN (Break down next steps)
  ├─→ EXECUTE (Run mutations)
  ├─→ VALIDATE (Check outcomes)
  └─→ REFLECT (Learn & adjust)
  ↓
Refined State
```

### Plan Mode (Planning-Focused)
```
Goal + Context
  ↓
[Plan Orchestrator]
  ├─→ UNDERSTAND (Analyze requirements)
  ├─→ GENERATE (Create plan(s))
  ├─→ VALIDATE (Check feasibility)
  ├─→ OPTIMIZE (Improve efficiency)
  ├─→ COMMUNICATE (Document)
  └─→ EXPORT (Hand to execution)
  ↓
Ready for Execution
```

## Component Deep Dives

### 1. Model Selector

#### Agent Mode (`agent/model-selector.ts`)
```typescript
Models grouped by:
- Fast: Mixtral 8x7B (quick analysis)
- Coding: Mixtral 8x7B (code generation)
- Analysis: Llama 3 70B (complex reasoning)

Selection based on:
- Task type (planning vs execution)
- Latency requirements
- Cost constraints
```

#### Plan Mode (`plan/model-selector.ts`)
```typescript
Models grouped by:
- Planning: Mixtral 8x7B (structured planning)
- Analysis: Llama 3 70B (complex reasoning)
- Optimization: Claude 3 Sonnet (algorithm thinking)

Selection based on:
- Planning phase (generate vs validate)
- Complexity of goal
- Optimization requirements
```

**Key Difference:** Agent prioritizes speed; Plan prioritizes reasoning quality.

### 2. Session Memory

#### Agent Mode (`agent/session-memory.ts`)
```typescript
Tracks:
- Learned Constraints (path patterns, naming)
- Error Patterns (ENOENT → "Create file first")
- Success Patterns (sequence of actions)
- Context Cache (recently-read files)
- Reflections (observations made)

Purpose:
- Prevent repeating errors
- Accelerate similar tasks
- Build execution intuition
```

#### Plan Mode (`plan/session-memory.ts`)
```typescript
Tracks:
- Planning Patterns (successful plan templates)
- Constraint Assumptions (project rules discovered)
- Risk Profiles (common risks & mitigations)
- Success Criteria (metrics for good plans)
- Planning Context (decision rationale)

Purpose:
- Generate better plans faster
- Respect discovered constraints
- Build planning intuition
- Learn what works well
```

**Key Difference:** Agent learns from execution; Plan learns from planning outcomes.

### 3. Item Tracking

#### Agent Mode (`agent/action-tracker.ts`)
```typescript
Tracks Actions:
- Type: file_create, file_modify, shell_command, etc.
- Status: pending → approved → executed → failed
- Details: reasoning, error context
- Metadata: user approval, execution time

Statistics:
- Total actions, mutations, execution rate
- Pending vs completed
- Error frequency
```

#### Plan Mode (`plan/plan-tracker.ts`)
```typescript
Tracks Plans:
- Status: draft → validated → approved → in-progress
- Versions: full history with diffs
- Changes: what modified, why
- Validation results: issues found
- Execution mapping: which tasks ran which actions

Statistics:
- Plan generation rate
- Validation pass rate
- Optimization improvements
- Execution fidelity
```

**Key Difference:** Actions track execution; Plans track planning evolution.

### 4. Step Generation

#### Agent Mode (`agent/action-planner.ts`)
```typescript
Input: Goal (e.g., "Create test file")

Pattern Matching:
- Test creation → planTestCreation()
- File creation → planFileCreation()
- Refactoring → planRefactoring()
- Deletion → planDeletion()

Output:
- List of MutationProposal[] (ready to execute)
- Risk assessment per action
- Dependency ordering
```

#### Plan Mode (`plan/plan-generator.ts`)
```typescript
Input: Goal + Context (e.g., "Create test file + constraints")

Pattern Matching:
- Feature implementation → planFeatureImplementation()
- Bug fix → planBugFix()
- Refactoring → planRefactoring()
- Testing → planTesting()

Output:
- Structured Plan with Tasks[] and Dependencies[]
- Effort estimation
- Multiple alternatives
- Pre-validation insights
```

**Key Difference:** Agent plans immediate next action; Plan generates full roadmap.

### 5. Validation

#### Agent Mode (`agent/reflection-engine.ts`)
```typescript
Validates After Execution:
- Did mutation succeed?
- Does outcome match intent?
- What went wrong if failed?
- What should we do next?

Output:
- Validation result
- Issues/recommendations
- Next steps suggestion
```

#### Plan Mode (`plan/plan-validator.ts`)
```typescript
Validates Before Execution:
- Are all dependencies satisfied?
- Do all constraints align?
- Is scope complete?
- Are estimates realistic?

Checks:
1. Dependency validation (no cycles)
2. Coverage validation (all requirements)
3. Feasibility assessment
4. Constraint compliance
5. Risk assessment

Output:
- Validation result with issues
- Severity ratings
- Improvement suggestions
```

**Key Difference:** Reflection validates execution outcome; Validator checks plan soundness.

### 6. Improvement Engine

#### Agent Mode (`agent/mutation-executor.ts`)
```typescript
Executes Actions:
- Low-risk: Auto-execute
- High-risk: Ask for approval
- Track execution metrics
- Adapt approval strategy

Purpose:
- Run approved mutations
- Handle errors gracefully
- Learn execution patterns
```

#### Plan Mode (`plan/plan-optimizer.ts`)
```typescript
Improves Plans:
- Parallelize independent tasks
- Reduce critical path
- Minimize bottlenecks
- Suggest alternatives
- Mitigate risks

Strategies:
1. Critical path analysis
2. Task parallelization
3. Dependency reduction
4. Workload balancing
5. Risk mitigation

Output:
- Optimized plan
- Timeline improvements
- Resource optimization
```

**Key Difference:** Executor runs things safely; Optimizer improves plans efficiently.

### 7. Orchestrator Pattern

Both modes follow similar orchestration:

#### Agent Mode Flow
```typescript
async orchestrate(goal: string) {
  1. observe() // Read codebase
  2. reason()  // Evaluate progress
  3. plan()    // Create next steps
  4. execute() // Run mutations
  5. validate() // Check results
  6. reflect()  // Learn & adjust
  // Loop until goal achieved
}
```

#### Plan Mode Flow
```typescript
async orchestrate(goal: string, context: Context) {
  1. understand() // Analyze goal
  2. generate()   // Create plan(s)
  3. validate()   // Check feasibility
  4. optimize()   // Improve efficiency
  5. communicate() // Document
  6. export()     // Hand to execution
  // Return ready plan
}
```

## Integration Points

### Sequential Workflow
```
Plan Mode                  Agent Mode
    ↓                          ↑
Generate plan      →    Execute plan
    ↓                          ↑
Validate plan      →    Feedback results
    ↓                          ↑
Optimize plan      →    Learn & iterate
```

### Shared Resources
1. **Codebase Context:** Both use same CodebaseContextManager
2. **Learning:** Both update shared constraints and patterns
3. **Models:** Both use same model infrastructure
4. **History:** Both create comprehensive logs

### Feedback Loop
```
Plan Mode generates plan
        ↓
Agent Mode executes plan
        ↓
Execution results → Plan Mode validation
        ↓
Improve future plans with learnings
```

## Testing Strategy Alignment

### Agent Mode Tests (`agent/agent.test.ts`)
- ActionTracker: Log, retrieve, filter, approve actions
- SessionMemoryManager: Constraints, error patterns, success patterns
- CodebaseContextManager: File indexing, searching
- ActionPlanner: Plan different task types
- ReflectionEngine: Validate mutations
- Integration: Full orchestration flow

### Plan Mode Tests (`plan/plan.test.ts`)
- PlanTracker: Version management, status tracking
- SessionMemoryManager: Planning patterns, constraints
- CodebaseContextManager: Context for planning
- PlanGenerator: Generate plans for task types
- PlanValidator: Validate plan feasibility
- PlanOptimizer: Improve plan efficiency
- Integration: Full orchestration flow

## File Organization

```
modes/
├── cli.ts                    # CLI entry point (both modes)
├── agent/
│   ├── action-planner.ts     # Generate action steps
│   ├── action-tracker.ts     # Track executed actions
│   ├── agent.test.ts         # Agent tests
│   ├── context-manager.ts    # Codebase context (shared)
│   ├── model-selector.ts     # Model selection (execution)
│   ├── mutation-executor.ts  # Execute mutations
│   ├── orchestrator.ts       # Coordinate agent phases
│   ├── reflection-engine.ts  # Validate execution
│   ├── session-memory.ts     # Execution learning
│   ├── types.ts              # Agent types
│   └── README.md             # Agent documentation
│
└── plan/                     # NEW
    ├── plan-generator.ts     # Generate plans
    ├── plan-tracker.ts       # Track plan versions
    ├── plan.test.ts          # Plan tests
    ├── context-manager.ts    # Reuse/alias of agent context
    ├── model-selector.ts     # Model selection (planning)
    ├── plan-optimizer.ts     # Optimize plans
    ├── plan-validator.ts     # Validate feasibility
    ├── orchestrator.ts       # Coordinate plan phases
    ├── session-memory.ts     # Planning learning
    ├── types.ts              # Plan types
    └── README.md             # Plan documentation
```

## Development Workflow

### For Plan Mode Implementation
1. **Implement types.ts first** - All other components depend on it
2. **Implement model-selector.ts** - Needed for all generation
3. **Implement session-memory.ts & plan-tracker.ts** - Infrastructure
4. **Implement plan-generator.ts** - Core value
5. **Implement plan-validator.ts** - Quality assurance
6. **Implement plan-optimizer.ts** - Efficiency improvement
7. **Implement orchestrator.ts** - Coordination
8. **Write comprehensive tests** - Verify all together
9. **Integrate with CLI** - Make available to users

### Testing Approach
- **Unit tests:** Each component in isolation
- **Integration tests:** Components working together
- **Orchestration tests:** Full planning workflow
- **Real-world tests:** Use actual project examples
