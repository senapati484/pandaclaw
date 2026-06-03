import { test, expect, describe } from "bun:test";
import { computeDiff, computeFileDiff, renderDiffSummary } from "../tools/diff-preview";

describe("Diff Preview", () => {
  test("detects added lines", () => {
    const oldContent = "line1\nline2\nline3";
    const newContent = "line1\nline2\nline3\nline4";
    const diff = computeDiff(oldContent, newContent);

    const added = diff.filter((l) => l.type === "added");
    expect(added.length).toBe(1);
    expect(added[0]?.content).toBe("line4");
  });

  test("detects removed lines", () => {
    const oldContent = "line1\nline2\nline3\nline4";
    const newContent = "line1\nline2\nline3";
    const diff = computeDiff(oldContent, newContent);

    const removed = diff.filter((l) => l.type === "removed");
    expect(removed.length).toBe(1);
    expect(removed[0]?.content).toBe("line4");
  });

  test("detects modified lines", () => {
    const oldContent = "line1\nline2\nold line\nline4";
    const newContent = "line1\nline2\nnew line\nline4";
    const diff = computeDiff(oldContent, newContent);

    const removed = diff.filter((l) => l.type === "removed");
    const added = diff.filter((l) => l.type === "added");
    expect(removed.length).toBe(1);
    expect(added.length).toBe(1);
    expect(removed[0]?.content).toBe("old line");
    expect(added[0]?.content).toBe("new line");
  });

  test("handles identical content", () => {
    const content = "line1\nline2\nline3";
    const diff = computeDiff(content, content);

    const unchanged = diff.filter((l) => l.type === "unchanged");
    const changed = diff.filter((l) => l.type !== "unchanged");
    expect(unchanged.length).toBeGreaterThan(0);
    expect(changed.length).toBe(0);
  });

  test("handles empty old content (new file)", () => {
    const diff = computeDiff("", "hello\nworld");
    const added = diff.filter((l) => l.type === "added");
    expect(added.length).toBe(2);
    expect(added[0]?.content).toBe("hello");
    expect(added[1]?.content).toBe("world");
  });

  test("handles empty new content (deletion)", () => {
    const diff = computeDiff("hello\nworld", "");
    const removed = diff.filter((l) => l.type === "removed");
    expect(removed.length).toBe(2);
    expect(removed[0]?.content).toBe("hello");
    expect(removed[1]?.content).toBe("world");
  });

  test("renderDiffSummary produces output for new file", () => {
    const diff = computeFileDiff("/tmp/nonexistent-test-file.ts", "const x = 1;\nconst y = 2;");
    expect(diff).not.toBeNull();
    if (diff) {
      const summary = renderDiffSummary(diff);
      expect(summary).toContain("+");
      expect(summary).toContain("const");
    }
  });

  test("renderDiffSummary is not empty for valid diff", () => {
    const diff = computeFileDiff("/nonexistent_path_xyz_test", "line1\nline2");
    expect(diff).not.toBeNull();
    if (diff) {
      const summary = renderDiffSummary(diff);
      expect(summary.length).toBeGreaterThan(0);
    }
  });
});
