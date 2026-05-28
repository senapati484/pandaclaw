import { test, expect } from "bun:test";
import { AskOrchestrator } from "./orchestrator";

test("AskOrchestrator responds to queries with codebase awareness", async () => {
  const orchestrator = new AskOrchestrator();
  await orchestrator.initializeSession();

  const hiRes = await orchestrator.askQuestion("Hi there!");
  expect(hiRes).toContain("Hello! I am PandaClaw.");

  const frameworksRes = await orchestrator.askQuestion("Which frameworks are detected?");
  expect(frameworksRes).toContain("detected the following frameworks");

  const filesRes = await orchestrator.askQuestion("Tell me about files and size");
  expect(filesRes).toContain("PandaClaw is tracking");
  expect(filesRes).toContain("files");

  const helpRes = await orchestrator.askQuestion("help me");
  expect(helpRes).toContain("analyze your codebase frameworks");

  const history = orchestrator.getSessionHistory();
  expect(history.length).toBe(8); // 4 questions + 4 answers
});
