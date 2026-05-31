// tools/apps/index.ts
// Entrypoint for application control tool — routes V2 actions to specialized controllers

import type { ToolDefinition } from "../../modes/agent/types.js";
import { openChromeUrl, searchChrome } from "./chrome.js";
import { openSafariUrl } from "./safari.js";
import { resolveLatestVideo } from "./youtube.js";
import { launchVsCode, controlService, adjustSystemSetting, handleClipboard, captureScreen } from "./system.js";
import { scrollBrowser, navigateBrowser, listTabs, switchToTab } from "./browser-actions.js";
import { simulateKeystroke, simulateKeyPress } from "./keyboard.js";

export const appControlTool: ToolDefinition = {
  name: "app_control",
  description: "Control native applications, services, settings, browsers, and inputs on the user's macOS device.",
  risky: false, // pre-authorized for trusted paired users
  readOnly: false,
  execute: async (args, context) => {
    const app = String(args.app ?? "").toLowerCase();
    const action = String(args.action ?? "").toLowerCase();

    if (!app) {
      throw new Error("Missing 'app' parameter in app_control.");
    }
    if (!action) {
      throw new Error("Missing 'action' parameter in app_control.");
    }

    switch (app) {
      case "chrome":
        if (action === "open_url") {
          const url = String(args.url ?? "");
          if (!url) throw new Error("Missing 'url' parameter for Chrome open_url");
          return await openChromeUrl(url);
        } else if (action === "search") {
          const query = String(args.query ?? "");
          if (!query) throw new Error("Missing 'query' parameter for Chrome search");
          return await searchChrome(query);
        }
        throw new Error(`Unsupported Chrome action: "${action}". Use 'open_url' or 'search'.`);

      case "safari":
        if (action === "open_url") {
          const url = String(args.url ?? "");
          if (!url) throw new Error("Missing 'url' parameter for Safari open_url");
          return await openSafariUrl(url);
        }
        throw new Error(`Unsupported Safari action: "${action}". Use 'open_url'.`);

      case "youtube":
        if (action === "resolve_latest") {
          const channel = String(args.channel ?? "");
          if (!channel) throw new Error("Missing 'channel' parameter for YouTube resolve_latest");
          return await resolveLatestVideo(channel, context);
        }
        throw new Error(`Unsupported YouTube action: "${action}". Use 'resolve_latest'.`);

      case "system":
        if (action === "vscode") {
          const folder = String(args.folder ?? "");
          if (!folder) throw new Error("Missing 'folder' parameter for system vscode action");
          return await launchVsCode(folder);
        } else if (action === "service") {
          const service = String(args.service ?? "");
          const state = String(args.state ?? "") as "start" | "stop";
          if (!service) throw new Error("Missing 'service' parameter for system service action");
          if (state !== "start" && state !== "stop") {
            throw new Error("Parameter 'state' must be 'start' or 'stop' for system service action");
          }
          return await controlService(service, state);
        } else if (action === "volume" || action === "brightness") {
          const value = Number(args.value);
          if (isNaN(value)) throw new Error(`Missing or invalid 'value' parameter for system ${action} action`);
          return await adjustSystemSetting(action, value);
        } else if (action === "clipboard") {
          const subAction = String(args.subAction ?? "") as "read" | "write";
          const text = args.text !== undefined ? String(args.text) : undefined;
          if (subAction !== "read" && subAction !== "write") {
            throw new Error("Parameter 'subAction' must be 'read' or 'write' for system clipboard action");
          }
          return await handleClipboard(subAction, text);
        } else if (action === "screenshot") {
          const path = String(args.path ?? ".pandaclaw/screenshot.png");
          return await captureScreen(path);
        }
        throw new Error(`Unsupported system action: "${action}".`);

      case "browser_action": {
        const browser = String(args.browser ?? "chrome").toLowerCase() as "chrome" | "safari";
        if (browser !== "chrome" && browser !== "safari") {
          throw new Error("Parameter 'browser' must be 'chrome' or 'safari' for browser_action");
        }

        if (action === "scroll") {
          const direction = String(args.direction ?? "") as "up" | "down" | "top" | "bottom";
          if (!["up", "down", "top", "bottom"].includes(direction)) {
            throw new Error("Parameter 'direction' must be 'up', 'down', 'top', or 'bottom' for browser_action scroll");
          }
          return await scrollBrowser(browser, direction);
        } else if (action === "navigate") {
          const navigateAction = String(args.navigateAction ?? "") as "back" | "forward" | "refresh" | "close_tab";
          if (!["back", "forward", "refresh", "close_tab"].includes(navigateAction)) {
            throw new Error("Parameter 'navigateAction' must be 'back', 'forward', 'refresh', or 'close_tab' for browser_action navigate");
          }
          return await navigateBrowser(browser, navigateAction);
        } else if (action === "list_tabs") {
          return await listTabs(browser);
        } else if (action === "switch_tab") {
          const target = args.target;
          if (target === undefined) {
            throw new Error("Missing 'target' (string or index number) parameter for browser_action switch_tab");
          }
          // Parse index if string number, otherwise focus title
          const parsed = typeof target === "number" ? target : isNaN(Number(target)) ? String(target) : Number(target);
          return await switchToTab(browser, parsed);
        }
        throw new Error(`Unsupported browser_action: "${action}".`);
      }

      case "keyboard":
        if (action === "type") {
          const text = String(args.text ?? "");
          if (!text) throw new Error("Missing 'text' parameter for keyboard type action");
          return await simulateKeystroke(text);
        } else if (action === "press_key") {
          const key = String(args.key ?? "");
          const modifiers = Array.isArray(args.modifiers) ? args.modifiers.map(String) : undefined;
          if (!key) throw new Error("Missing 'key' parameter for keyboard press_key action");
          return await simulateKeyPress(key, modifiers);
        }
        throw new Error(`Unsupported keyboard action: "${action}".`);

      default:
        throw new Error(`Unsupported application controller: "${app}".`);
    }
  },
};
