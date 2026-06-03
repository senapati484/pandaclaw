import { test, expect, describe, beforeAll } from "bun:test";
import { Logger, getGlobalLogger, resetGlobalLogger } from "../utils/logger";

describe("Logger", () => {
  let logger: Logger;

  beforeAll(() => {
    logger = new Logger("test-session");
  });

  test("stores events in memory", () => {
    logger.info("test message", { key: "value" });
    const events = logger.getEvents();
    expect(events.length).toBeGreaterThan(0);
    const event = events[events.length - 1];
    expect(event?.message).toBe("test message");
    expect(event?.level).toBe("info");
    expect(event?.sessionId).toBe("test-session");
  });

  test("stores info events (default log level)", () => {
    logger.info("info event test");
    const events = logger.getEvents();
    const infoEvents = events.filter((e) => e.level === "info" && e.message === "info event test");
    expect(infoEvents.length).toBeGreaterThan(0);
  });

  test("stores warn events", () => {
    logger.warn("warn message", { warning: true });
    const events = logger.getEvents();
    const warnEvents = events.filter((e) => e.level === "warn" && e.message === "warn message");
    expect(warnEvents.length).toBeGreaterThan(0);
    const event = warnEvents[warnEvents.length - 1];
    expect(event?.details?.warning).toBe(true);
  });

  test("stores error events", () => {
    logger.error("error message", { error: "something broke" });
    const events = logger.getEvents();
    const errorEvents = events.filter((e) => e.level === "error" && e.message === "error message");
    expect(errorEvents.length).toBeGreaterThan(0);
  });

  test("getRecentEvents returns limited events", () => {
    const recent = logger.getRecentEvents(undefined, 5);
    expect(recent.length).toBeLessThanOrEqual(5);
  });

  test("getRecentEvents filters by level", () => {
    const errors = logger.getRecentEvents("error", 10);
    for (const e of errors) {
      expect(["error", "warn"]).toContain(e.level);
    }
  });

  test("exportJson produces valid JSON", () => {
    const json = logger.exportJson();
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
  });
});

describe("Global Logger", () => {
  test("getGlobalLogger returns same instance without sessionId", () => {
    resetGlobalLogger();
    const logger1 = getGlobalLogger();
    const logger2 = getGlobalLogger();
    expect(logger1).toBe(logger2);
  });

  test("getGlobalLogger creates new instance with sessionId", () => {
    resetGlobalLogger();
    const logger1 = getGlobalLogger("session-1");
    const logger2 = getGlobalLogger("session-2");
    expect(logger1).not.toBe(logger2);
  });
});
