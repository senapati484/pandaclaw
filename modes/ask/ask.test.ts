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

test("classifyRoute correctly classifies full-device action queries", () => {
  const { classifyRoute } = require("./classifier");

  expect(classifyRoute("Delete the fimonacci file")).toBe("action");
  expect(classifyRoute("delete file notes.txt")).toBe("action");
  expect(classifyRoute("Open youtube")).toBe("action");
  expect(classifyRoute("Open youtube is the browser")).toBe("action");
  expect(classifyRoute("open chrome to google.com")).toBe("action");
  expect(classifyRoute("start Ollama")).toBe("action");
  expect(classifyRoute("start the Visual Studio Code open this folder")).toBe("action");
  expect(classifyRoute("set volume to 60%")).toBe("action");
  expect(classifyRoute("scroll down in safari")).toBe("action");
  expect(classifyRoute("type hello world and press enter")).toBe("action");

  // Non-action quick queries should not route to 'action'
  expect(classifyRoute("What is the capital of France?")).not.toBe("action");
  expect(classifyRoute("Explain photosynthesis")).not.toBe("action");
});

