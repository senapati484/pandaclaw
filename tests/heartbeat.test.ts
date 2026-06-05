// tests/heartbeat.test.ts
import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import { matchesCron, getNextRunTime, HeartbeatEngine } from "../utils/heartbeat.js";

describe("Heartbeat Scheduler & matchesCron", () => {
  test("matches wildcards", () => {
    const d = new Date("2026-06-05T12:00:00");
    expect(matchesCron("* * * * *", d)).toBe(true);
  });

  test("matches specific minute and hour", () => {
    const d = new Date("2026-06-05T08:00:00");
    expect(matchesCron("0 8 * * *", d)).toBe(true);
    expect(matchesCron("0 9 * * *", d)).toBe(false);
  });

  test("matches steps (e.g. every 5 minutes)", () => {
    const d1 = new Date("2026-06-05T12:05:00");
    const d2 = new Date("2026-06-05T12:07:00");
    expect(matchesCron("*/5 * * * *", d1)).toBe(true);
    expect(matchesCron("*/5 * * * *", d2)).toBe(false);
  });

  test("matches ranges", () => {
    const d1 = new Date("2026-06-05T12:00:00"); // Friday (dow = 5)
    const d2 = new Date("2026-06-07T12:00:00"); // Sunday (dow = 0)
    expect(matchesCron("* * * * 1-5", d1)).toBe(true);
    expect(matchesCron("* * * * 1-5", d2)).toBe(false);
  });

  test("computes next run time", () => {
    const next = getNextRunTime("0 8 * * *");
    expect(next.getHours()).toBe(8);
    expect(next.getMinutes()).toBe(0);
  });
});

describe("HeartbeatEngine", () => {
  let writeSpy: any;
  let existsSpy: any;
  let readSpy: any;

  beforeEach(() => {
    writeSpy = spyOn(fs, "writeFileSync").mockImplementation(() => {});
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockReturnValue("[]");
  });

  afterEach(() => {
    writeSpy.mockRestore();
    existsSpy.mockRestore();
    readSpy.mockRestore();
  });

  test("adds a scheduled task and saves it", () => {
    const engine = new HeartbeatEngine();
    const task = engine.add({
      name: "Test Morning news",
      cron: "0 8 * * *",
      prompt: "Give me news",
      channel: "cli",
    });

    expect(task.id).toBeDefined();
    expect(task.name).toBe("Test Morning news");
    expect(task.enabled).toBe(true);
    expect(writeSpy).toHaveBeenCalled();
  });

  test("removes task by ID", () => {
    const engine = new HeartbeatEngine();
    const task = engine.add({
      name: "Temp",
      cron: "* * * * *",
      prompt: "hi",
      channel: "cli",
    });

    const ok = engine.remove(task.id);
    expect(ok).toBe(true);
  });

  test("pauses and resumes task", () => {
    const engine = new HeartbeatEngine();
    const task = engine.add({
      name: "Temp",
      cron: "* * * * *",
      prompt: "hi",
      channel: "cli",
    });

    engine.pause(task.id, false);
    expect(engine.getTasks()[0]?.enabled).toBe(false);

    engine.pause(task.id, true);
    expect(engine.getTasks()[0]?.enabled).toBe(true);
  });
});
