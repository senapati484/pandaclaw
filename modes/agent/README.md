# Agent Mode Architecture

## Overview

**Agent Mode** is a Reactor Agent system that autonomously plans and executes project tasks with human oversight. It operates in a continuous loop of observation, reasoning, planning, execution, validation, and reflection.

## Architecture

### Core Components

#### 1. **Model Selector** (`model-selector.ts`)
- Auto-selects best model based on task type and availability
- Prioritizes Groq free tier (generous limits)
- Falls back to OpenRouter when needed
- Caches model selection per task type

**Models:**
- **Groq (Preferred):**
  - Fast: Mixtral 8x7B (general purpose)
  - Coding: Mixtral 8x7B (code generation/analysis)
  - Analysis: Llama 3 70B (complex reasoning)
- **OpenRouter (Fallback):**
  - Fast: Mistral 7B
  - Coding: CodeLlama 34B
  - Analysis: Llama 3 70B

#### 2. **Codebase Context Manager** (`context-manager.ts`)
- Incrementally indexes the codebase on-demand
- Scans file tree, builds imports/exports map
- Detects frameworks and naming patterns
- Caches file content with hash tracking
- Provides file search, language filtering, and importer tracking

**Key Features:**
- Lightweight initial scan
- On-demand file reading
- Pattern analysis
- Framework detection

#### 3. **Session Memory Manager** (`session-memory.ts`)
- Stores session-scoped learning within a session
- Tracks learned constraints and error patterns
- Records successful approaches
- Maintains context cache
- Provides reflection history

**Memory Types:**
- Learned Constraints: Forbidden paths, naming conventions, patterns
- Error Patterns: Frequency-based tracking with suggested fixes
- Success Patterns: Reusable approaches for similar tasks
- Context Cache: Recently-read files for quick access
- Reflections: Observations and adjustments made

#### 4. **Action Tracker** (`action-tracker.ts`)
- Logs all actions (file ops, analysis, shell commands)
- Tracks action status (pending, executed, approved, rejected, failed)
- Differentiates mutations (file/folder/shell ops) from read-only actions
- Provides statistics and history

#### 5. **Action Planner** (`action-planner.ts`)
- Breaks down goals into actionable steps
- Creates mutation plans with dependencies
- Pattern-matches common tasks (test creation, file creation, refactoring, deletion)
- Estimates risk and approval requirements

#### 6. **Reflection Engine** (`reflection-engine.ts`)
- Validates mutations against intent
- Analyzes failure patterns
- Suggests next steps based on goal
- Provides error-specific fixes

#### 7. **Mutation Executor** (`mutation-executor.ts`)
- Executes mutations (file create/modify/delete, folder ops, shell commands)
- Implements hybrid approval: auto-execute low-risk, ask for high-risk
- Tracks execution count and adapts behavior
- Handles errors gracefully

#### 8. **Agent Orchestrator** (`orchestrator.ts`)
- Manages the reactor loop lifecycle
- Coordinates all components
- Implements the 6-phase reactor pattern

### Reactor Loop Phases

```
1. OBSERVE
   └─ Read current codebase state
   └─ Check learned constraints and patterns
   └─ Assess session memory

2. REASON
   └─ Evaluate progress toward goal
   └─ Decide if more work needed

3. PLAN
   └─ For complex tasks: create step-by-step plan
   └─ Analyze dependencies
   └─ Estimate risk

4. EXECUTE
   └─ For each mutation:
      ├─ Estimate risk
      ├─ Auto-execute (low risk)
      └─ Or ask for approval (high risk)

5. VALIDATE
   └─ Check if mutation succeeded
   └─ Compare result vs intent
   └─ Record issues

6. REFLECT
   └─ Analyze failure patterns
   └─ Learn from outcomes
   └─ Record successful patterns
   └─ Update constraints

Loop until goal complete or max iterations (20)
```

## Data Structures

### Core Types

```typescript
interface ReactorSession {
  id: string;
  goal: string;
  modelConfigs: Map<ModelTaskType, ModelConfig>;
  codebaseIndex: CodebaseIndex;
  actionHistory: ActionLog[];
  sessionMemory: SessionMemory;
  isRunning: boolean;
  iterationCount: number;
  maxIterations: number;
  config: AgentConfig;
}

interface MutationProposal {
  id: string;
  type: MutationType;
  path: string;
  content?: string;
  command?: string;
  rationale: string;
  estimatedRisk: "low" | "medium" | "high";
  requiresApproval: boolean;
}

interface MutationPlan {
  steps: MutationProposal[];
  estimatedRisk: "low" | "medium" | "high";
  requiresApproval: boolean;
  totalMutations: number;
  description: string;
  dependencies: string[];
}
```

## Safety & Approval System

### Risk Estimation

**High-Risk** (Always Ask):
- File deletion
- Folder deletion
- Shell commands
- Changes to config files (.env, package.json, tsconfig.json)
- Files in ask-first patterns

**Medium-Risk** (Ask After N Mutations):
- File modifications >50KB
- After auto-executing 5+ mutations

**Low-Risk** (Auto-Execute):
- File creation in allowed paths (src/, tests/, modes/)
- File edits <50KB
- Folder creation

### Approval Flow

```
User Goal
  ↓
Create Plan
  ↓
For each mutation:
  ├─ Estimate risk
  ├─ Low → Execute immediately → Log & Validate
  ├─ Medium → Check counter → Execute or Ask
  └─ High → Ask user → Execute if approved
```

## Configuration

```typescript
interface AgentConfig {
  codebasePath: string;
  maxFileSizeToRead: number; // 1MB default
  autoExecutePaths: string[]; // Paths to auto-execute in
  askFirstPaths: string[]; // Paths that always require approval
  askFirstPatterns: string[]; // Patterns to avoid
  tools: {
    allowShellExecution: boolean;
    allowFileModification: boolean;
    allowFileCreation: boolean;
    allowFolderCreation: boolean;
  };
  approvalThresholds: {
    autoExecuteMutationLimit: number; // 5 default
    autoExecuteFileSizeLimit: number; // 50KB default
    alwaysAskFor: MutationType[];
  };
}
```

## Usage Flow

```typescript
// 1. Create orchestrator
const orchestrator = new AgentOrchestrator();

// 2. Initialize session with goal
await orchestrator.initializeSession("Create a test file for ActionTracker");

// 3. Run the reactor loop
await orchestrator.runReactorLoop();

// Result: Agent plans, executes (with approvals), validates, and reflects
```

## Error Handling & Recovery

- **Retryable errors** (timeout, rate limit, connection): Auto-retry
- **Non-retryable errors** (syntax, permission): Ask user for next steps
- **Validation failures**: Record pattern, suggest fix
- **Max iterations reached**: Stop gracefully, summarize work

## Learning System

### During Session
- **Constraints**: Learn paths to avoid, naming conventions, patterns
- **Error Patterns**: Track errors and their fixes
- **Success Patterns**: Record successful approaches
- **Reflections**: Note observations and adjustments

### Between Sessions
- Session memory is cleared (session-scoped)
- Long-term learning would require persistence (future feature)

## Example Workflow

**Goal:** "Create a test file for ActionTracker"

```
OBSERVE: Index codebase → Find action-tracker.ts
REASON: Goal seems achievable
PLAN: 
  - Create tests/action-tracker.test.ts
  - Analyze ActionTracker class structure
  - Write test suites
EXECUTE (Low Risk → Auto):
  - Create tests/action-tracker.test.ts ✓
VALIDATE:
  - File exists ✓
  - Has correct structure ✓
REFLECT:
  - Success! Pattern: test files follow *.test.ts
  - Store for future reference
COMPLETE: Goal achieved
```

## Integration Points

### With CLI
- `pandaclaw wakeup` → CLI menu → Agent Mode → Goal input → Reactor loop

### With Other Modes
- **Plan Mode**: Could use agent's mutation plans
- **Ask Mode**: Could use agent's learned constraints and patterns

### Future Extensions
- Persistent learning across sessions
- Multi-session projects
- Undo/rollback capabilities
- Parallel mutation execution
- Custom LLM backends
