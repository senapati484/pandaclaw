import { readdirSync, statSync, readFileSync } from "fs";
import { join, relative, extname } from "path";
import type { CodebaseIndex, FileInfo, CachedFile } from "./types";

const IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  ".github",
  "dist",
  "build",
  ".env",
  ".env.local",
  "*.log",
  ".DS_Store",
  ".next",
  ".turbo",
  "coverage",
];

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript-react",
  ".js": "javascript",
  ".jsx": "javascript-react",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".json": "json",
};

export class CodebaseContextManager {
  private index: CodebaseIndex;
  private fileCache: Map<string, CachedFile> = new Map();
  private codebasePath: string;
  private maxFileSize: number;

  constructor(codebasePath: string, maxFileSize: number = 1024 * 1024) {
    this.codebasePath = codebasePath;
    this.maxFileSize = maxFileSize;
    this.index = {
      files: new Map(),
      folders: new Map(),
      imports: new Map(),
      exports: new Map(),
      frameworks: [],
      patterns: [],
      lastUpdated: new Date(),
    };
  }

  /**
   * Incrementally index codebase on-demand
   * Scans directory tree once, builds file map
   */
  async indexCodebase(): Promise<CodebaseIndex> {
    this.scanDirectory(this.codebasePath);
    this.detectFrameworks();
    this.analyzePatterns();
    this.index.lastUpdated = new Date();
    return this.index;
  }

  /** Public read-only accessor for the current index */
  getCodebaseIndex(): CodebaseIndex {
    return this.index;
  }

  /**
   * Refresh specific file or folder in index
   */
  refreshPath(path: string): void {
    if (this.shouldIgnore(path)) return;

    try {
      const stat = statSync(path);
      const relativePath = relative(this.codebasePath, path);

      if (stat.isFile()) {
        const fileInfo = this.createFileInfo(path, stat, relativePath);
        this.index.files.set(relativePath, fileInfo);
        this.fileCache.delete(relativePath);
      } else if (stat.isDirectory()) {
        const folderInfo = this.createFileInfo(path, stat, relativePath);
        this.index.folders.set(relativePath, folderInfo);
      }
    } catch (error) {
      console.error(`Failed to refresh path ${path}:`, error);
    }
  }

  /**
   * Get cached file content or read from disk
   */
  async getFileContent(filePath: string): Promise<string | null> {
    const relativePath = relative(this.codebasePath, filePath);

    // Check cache first
    if (this.fileCache.has(relativePath)) {
      return this.fileCache.get(relativePath)!.content;
    }

    try {
      const fullPath = join(this.codebasePath, relativePath);
      const stat = statSync(fullPath);

      if (stat.size > this.maxFileSize) {
        console.warn(`File too large to cache: ${relativePath} (${stat.size} bytes)`);
        return null;
      }

      const content = readFileSync(fullPath, "utf-8");
      const hash = this.simpleHash(content);

      this.fileCache.set(relativePath, {
        path: relativePath,
        content,
        hash,
        readAt: new Date(),
      });

      return content;
    } catch (error) {
      console.error(`Failed to read file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Search for files matching pattern
   */
  findFiles(pattern: string | RegExp): FileInfo[] {
    const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
    return Array.from(this.index.files.values()).filter((file) => regex.test(file.path));
  }

  /**
   * Get all files of a specific type
   */
  getFilesByLanguage(language: string): FileInfo[] {
    return Array.from(this.index.files.values()).filter((file) => file.language === language);
  }

  /**
   * Get files that import a specific module
   */
  findImporters(modulePath: string): string[] {
    const importers: string[] = [];
    this.index.imports.forEach((imports, filePath) => {
      if (imports.some((imp) => imp.includes(modulePath))) {
        importers.push(filePath);
      }
    });
    return importers;
  }

  /**
   * Get the current codebase index
   */
  getIndex(): CodebaseIndex {
    return this.index;
  }

  /**
   * Clear caches (for testing or refreshing)
   */
  clearCaches(): void {
    this.fileCache.clear();
  }

  // ============ Private Helpers ============

  private scanDirectory(dirPath: string, depth: number = 0): void {
    if (depth > 10) return; // Prevent deep recursion

    try {
      const files = readdirSync(dirPath);

      for (const file of files) {
        const fullPath = join(dirPath, file);

        if (this.shouldIgnore(fullPath)) continue;

        try {
          const stat = statSync(fullPath);
          const relativePath = relative(this.codebasePath, fullPath);

          if (stat.isFile()) {
            const fileInfo = this.createFileInfo(fullPath, stat, relativePath);
            this.index.files.set(relativePath, fileInfo);
          } else if (stat.isDirectory()) {
            const folderInfo = this.createFileInfo(fullPath, stat, relativePath);
            this.index.folders.set(relativePath, folderInfo);
            this.scanDirectory(fullPath, depth + 1);
          }
        } catch (error) {
          // Skip files we can't stat
        }
      }
    } catch (error) {
      console.error(`Failed to scan directory ${dirPath}:`, error);
    }
  }

  private createFileInfo(fullPath: string, stat: any, relativePath: string): FileInfo {
    return {
      path: relativePath,
      size: stat.size || 0,
      type: stat.isDirectory() ? "folder" : "file",
      language: stat.isFile() ? LANGUAGE_EXTENSIONS[extname(fullPath)] : undefined,
      isIgnored: false,
    };
  }

  private shouldIgnore(path: string): boolean {
    return IGNORE_PATTERNS.some((pattern) => {
      if (pattern.startsWith("*")) {
        const ext = pattern.slice(1);
        return path.endsWith(ext);
      }
      return path.includes(pattern);
    });
  }

  private detectFrameworks(): void {
    // Check for common framework indicators
    const frameworks: string[] = [];

    // Check package.json for frameworks
    const packageJsonFiles = this.findFiles(/package\.json$/);
    for (const file of packageJsonFiles) {
      const path = join(this.codebasePath, file.path);
      try {
        const content = readFileSync(path, "utf-8");
        const pkg = JSON.parse(content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        if (deps.react) frameworks.push("react");
        if (deps.vue) frameworks.push("vue");
        if (deps.svelte) frameworks.push("svelte");
        if (deps.express) frameworks.push("express");
        if (deps.nestjs) frameworks.push("nestjs");
        if (deps.bun) frameworks.push("bun");
      } catch (error) {
        // Skip if can't parse
      }
    }

    this.index.frameworks = [...new Set(frameworks)];
  }

  private analyzePatterns(): void {
    const patterns = new Set<string>();

    // Analyze file naming patterns
    this.index.files.forEach((file) => {
      if (file.path.includes(".test.")) patterns.add("test-files");
      if (file.path.includes(".spec.")) patterns.add("spec-files");
      if (file.path.includes(".d.ts")) patterns.add("type-definitions");
      if (file.path.startsWith("src/")) patterns.add("src-structure");
      if (file.path.startsWith("tests/")) patterns.add("tests-structure");
    });

    this.index.patterns = Array.from(patterns);
  }

  private simpleHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }
}

export async function createContextManager(codebasePath: string): Promise<CodebaseContextManager> {
  const manager = new CodebaseContextManager(codebasePath);
  await manager.indexCodebase();
  return manager;
}
