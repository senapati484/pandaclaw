// ai/context-compressor.ts
// Converts verbose JSON structures into token-efficient text formats.
//
// Token savings summary:
//   compressCodebaseIndex  → ~85% fewer tokens (15,000 → ~1,200 for 300 files)
//   compressActionHistory  → ~60% fewer tokens  (10,000 → ~800 for 20 actions)
//   compressFileContent    → ~90% fewer tokens  (8,000-token file → ~600 tokens)
//   compressMemoryForPrompt→ ~70% fewer tokens
//   sliceContextForWorker  → ~75% per worker (each role gets only what it needs)

import type {
  CodebaseIndex,
  ActionLog,
  SessionMemory,
} from "../modes/agent/types.js";

// ── Compact codebase index ─────────────────────────────────────────────────
// BEFORE (full JSON): ~15,000 tokens for 300 files
// AFTER  (compact):    ~1,200 tokens for same 300 files
export function compressCodebaseIndex(
  index: CodebaseIndex,
  maxFiles = 80
): string {
  const lines: string[] = [];

  if (index.frameworks.length) {
    lines.push(`stack: ${index.frameworks.join(",")}`);
  }

  if (index.patterns.length) {
    lines.push(`patterns: ${index.patterns.join(",")}`);
  }

  const files = [...index.files.values()]
    .filter((f) => !f.isIgnored)
    .slice(0, maxFiles);

  lines.push(`files(${files.length}):`);
  for (const f of files) {
    const lang = f.language ? ` [${f.language}]` : "";
    const imports = f.imports?.length
      ? ` imp:${f.imports.slice(0, 4).join(",")}`
      : "";
    lines.push(`  ${f.path}${lang}${imports}`);
  }

  const folders = [...index.folders.keys()].slice(0, 20);
  if (folders.length) {
    lines.push(`dirs: ${folders.join(",")}`);
  }

  return lines.join("\n");
}

// ── Compact action history ─────────────────────────────────────────────────
// BEFORE (full JSON): ~500 tokens per action × 20 actions = 10,000 tokens
// AFTER  (compact):    ~40 tokens per action  × 20 actions =    800 tokens
export function compressActionHistory(
  actions: ActionLog[],
  keep = 8
): string {
  if (actions.length === 0) return "(no actions yet)";

  const recent = actions.slice(-keep);
  return recent
    .map((a) => {
      const status =
        a.status === "executed"
          ? "✓"
          : a.status === "failed"
          ? "✗"
          : a.status === "rejected"
          ? "⊘"
          : "~";
      const detail = a.details.reasoning
        ? ` — ${a.details.reasoning.slice(0, 80)}`
        : a.details.error
        ? ` ERR:${a.details.error.slice(0, 60)}`
        : "";
      return `${status} [${a.type}] ${a.path}${detail}`;
    })
    .join("\n");
}

// ── File content — smart truncation ───────────────────────────────────────
// Send head + tail of large files instead of full content.
// BEFORE: 8,000 token file sent in full
// AFTER:  ~600 tokens (first 40 + last 20 lines + summary)
export function compressFileContent(
  path: string,
  content: string,
  maxLines = 60
): string {
  const lines = content.split("\n");
  if (lines.length <= maxLines) return content;

  const head = lines.slice(0, 40).join("\n");
  const tail = lines.slice(-20).join("\n");
  const skipped = lines.length - 60;

  return `${head}\n\n... [${skipped} lines omitted — ${path}] ...\n\n${tail}`;
}

// ── Compact memory entries ─────────────────────────────────────────────────
// BEFORE: full JSON array of MemoryEntry objects
// AFTER:  one line per entry, only meaningful constraints/patterns
export function compressMemoryForPrompt(memory: SessionMemory): string {
  const parts: string[] = [];

  if (memory.learnedConstraints.length > 0) {
    const constraints = memory.learnedConstraints
      .slice(0, 10)
      .map((c) => `  [${c.type}] ${c.value}`)
      .join("\n");
    parts.push(`constraints:\n${constraints}`);
  }

  if (memory.successPatterns.length > 0) {
    const successes = memory.successPatterns
      .slice(0, 5)
      .map((s) => `  [worked] ${s.description}`)
      .join("\n");
    parts.push(`proven_patterns:\n${successes}`);
  }

  const errorList = [...memory.errorPatterns.values()]
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 5);

  if (errorList.length > 0) {
    const errors = errorList
      .map((e) => `  [avoid] ${e.pattern} → ${e.suggestedFix}`)
      .join("\n");
    parts.push(`known_errors:\n${errors}`);
  }

  if (memory.reflections.length > 0) {
    const recent = memory.reflections.slice(-3);
    const refs = recent
      .map((r) => `  [reflect] ${r.observation} → ${r.adjustment}`)
      .join("\n");
    parts.push(`recent_reflections:\n${refs}`);
  }

  return parts.length > 0 ? parts.join("\n\n") : "(no memory yet)";
}

// ── Worker context slice ───────────────────────────────────────────────────
// Each swarm worker gets only what it actually needs to do its job.
//
//   researcher  → full file tree (compressed) + memory, NO file contents
//   coder       → 5 most relevant file contents + memory, minimal index
//   verifier    → only the changed file content + memory
//   visualizer  → compact index only (no file contents)
//
export function sliceContextForWorker(
  role: "researcher" | "coder" | "verifier" | "visualizer",
  index: CodebaseIndex,
  memory: SessionMemory,
  relevantPaths: string[] = []
): string {
  const memStr = compressMemoryForPrompt(memory);

  switch (role) {
    case "researcher": {
      // Gets full file tree (compressed) but no file contents
      const idx = compressCodebaseIndex(index, 100);
      return `${idx}\n\n${memStr}`;
    }

    case "coder": {
      // Gets compact index + up to 5 relevant file contents
      const idx = compressCodebaseIndex(index, 30);
      const fileContents = relevantPaths
        .slice(0, 5)
        .map((p) => {
          const cached = memory.contextCache.get(p);
          if (!cached) return `// ${p} — (not in cache, will need to read)`;
          return `// === ${p} ===\n${compressFileContent(p, cached.content)}`;
        })
        .join("\n\n");
      return [idx, fileContents, memStr].filter(Boolean).join("\n\n");
    }

    case "verifier": {
      // Gets only the one changed file content + memory
      const target = relevantPaths[0];
      if (!target) return memStr;
      const cached = memory.contextCache.get(target);
      const fileStr = cached
        ? `// === ${target} (target) ===\n${compressFileContent(target, cached.content)}`
        : `target_file: ${target}`;
      return `${fileStr}\n\n${memStr}`;
    }

    case "visualizer": {
      // Gets no file content — just compact index + memory
      const idx = compressCodebaseIndex(index, 50);
      return `${idx}\n\n${memStr}`;
    }
  }
}

// ── Full prompt context builder ────────────────────────────────────────────
// Drop-in replacement for raw JSON serialization of ReactorSession.
// Call this instead of JSON.stringify(session) when building prompts.
// Typical reduction: 25,000 tokens → ~2,500 tokens
export function buildPromptContext(
  goal: string,
  index: CodebaseIndex,
  actions: ActionLog[],
  memory: SessionMemory,
  relevantPaths: string[] = []
): string {
  const goalLine = `goal: ${goal}`;
  const indexStr = compressCodebaseIndex(index, 80);
  const actionsStr = compressActionHistory(actions, 8);
  const memStr = compressMemoryForPrompt(memory);

  // Relevant file contents if provided
  const fileContents = relevantPaths
    .slice(0, 3)
    .map((p) => {
      const cached = memory.contextCache.get(p);
      if (!cached) return null;
      return `// === ${p} ===\n${compressFileContent(p, cached.content)}`;
    })
    .filter(Boolean)
    .join("\n\n");

  return [
    goalLine,
    indexStr,
    fileContents && `relevant_files:\n${fileContents}`,
    `recent_actions:\n${actionsStr}`,
    memStr,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Minifies and compresses any JSON string or object to be extremely token-efficient.
 * - Strips all spaces, indentation, and newlines.
 * - Recursively prunes/truncates extremely long text values in the JSON (e.g. >250 chars) to prevent token blowup.
 * - If the JSON structure is extremely large, prunes deep arrays or nested structures.
 */
export function compressJson(data: unknown): string {
  if (data === undefined || data === null) return "";

  // Parse if it is a string representing JSON
  let obj: unknown = data;
  if (typeof data === "string") {
    const trimmed = data.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        obj = JSON.parse(trimmed);
      } catch {
        // Not valid JSON, return as is
        return trimmed;
      }
    } else {
      return trimmed;
    }
  }

  // Recursively prune/truncate long values and deep nesting to save tokens
  function prune(val: unknown, depth = 0): unknown {
    if (depth > 5) return "... [max depth reached]";
    if (typeof val === "string") {
      // Truncate excessively long strings (like base64, HTML dumps, long descriptions) in JSON values
      if (val.length > 250) {
        return val.slice(0, 250) + `... [truncated ${val.length - 250} chars]`;
      }
      return val;
    }
    if (Array.isArray(val)) {
      // Limit arrays to 15 items maximum to avoid token bloat
      if (val.length > 15) {
        const sliced = val.slice(0, 15).map((item) => prune(item, depth + 1));
        sliced.push(`... [truncated ${val.length - 15} items]`);
        return sliced;
      }
      return val.map((item) => prune(item, depth + 1));
    }
    if (val !== null && typeof val === "object") {
      const prunedObj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) {
        prunedObj[k] = prune(v, depth + 1);
      }
      return prunedObj;
    }
    return val;
  }

  try {
    const prunedObj = prune(obj);
    return JSON.stringify(prunedObj); // Stringify without spaces or newlines (fully compressed)
  } catch {
    return typeof obj === "object" ? JSON.stringify(obj) : String(obj);
  }
}

