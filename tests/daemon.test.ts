// tests/daemon.test.ts
import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as child_process from "child_process";
import * as os from "os";
import { startDaemon, stopDaemon, daemonStatus } from "../tui/daemon.js";

describe("Daemon Mode", () => {
  let writeSpy: any;
  let execSpy: any;
  let mkdirSpy: any;
  let osPlatformSpy: any;

  beforeEach(() => {
    writeSpy = spyOn(fs, "writeFileSync").mockImplementation(() => {});
    mkdirSpy = spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    execSpy = spyOn(child_process, "execSync").mockImplementation((() => Buffer.from("")) as any);
  });

  afterEach(() => {
    writeSpy.mockRestore();
    mkdirSpy.mockRestore();
    execSpy.mockRestore();
    if (osPlatformSpy) {
      osPlatformSpy.mockRestore();
      osPlatformSpy = null;
    }
  });

  test("generates plist on macOS", () => {
    osPlatformSpy = spyOn(os, "platform").mockReturnValue("darwin");

    startDaemon();

    expect(writeSpy).toHaveBeenCalled();
    const [pathArg, contentArg] = writeSpy.mock.calls[0];
    expect(pathArg).toContain("com.pandaclaw.plist");
    expect(contentArg).toContain("<key>Label</key>");
    expect(contentArg).toContain("com.pandaclaw");
    expect(contentArg).toContain("daemon.log");
    
    expect(execSpy).toHaveBeenCalledWith(expect.stringContaining("launchctl load"));
  });

  test("generates systemd service on Linux", () => {
    osPlatformSpy = spyOn(os, "platform").mockReturnValue("linux");

    startDaemon();

    expect(writeSpy).toHaveBeenCalled();
    const [pathArg, contentArg] = writeSpy.mock.calls[0];
    expect(pathArg).toContain("com.pandaclaw.service");
    expect(contentArg).toContain("[Unit]");
    expect(contentArg).toContain("Description=PandaClaw Daemon Service");
    expect(contentArg).toContain("Restart=always");

    expect(execSpy).toHaveBeenCalledWith(expect.stringContaining("systemctl --user daemon-reload"));
  });

  test("stops daemon service", () => {
    osPlatformSpy = spyOn(os, "platform").mockReturnValue("darwin");
    stopDaemon();
    expect(execSpy).toHaveBeenCalledWith(expect.stringContaining("launchctl unload"));
  });
});
