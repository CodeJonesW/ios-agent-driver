#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  bootSim,
  installApp,
  launchApp,
  listDevices,
  openUrl,
  resolveUdid,
  screenshot,
  setPrivacy,
  terminateApp,
  uninstallApp,
} from "./simctl.js";
import { describeUi, pressButton, swipe, tap, typeText, type HardwareButton } from "./idb.js";
import { center, findByLabel, nearestLabels } from "./ax.js";

const server = new McpServer({
  name: "ios-agent-driver",
  version: "0.1.0",
});

type ToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  isError?: boolean;
};

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function json(value: unknown): ToolResult {
  return ok(JSON.stringify(value, null, 2));
}

function fail(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `ERROR: ${message}` }], isError: true };
}

/**
 * Register a tool whose thrown errors become loud, structured tool errors.
 * `server.tool` has many overloads that defeat generic inference here, so we
 * cast it to the one precise signature we use — call sites stay fully typed.
 */
const register = server.tool.bind(server) as unknown as <S extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  cb: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResult>,
) => void;

function tool<S extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResult>,
): void {
  register(name, description, shape, async (args) => {
    try {
      return await handler(args);
    } catch (err) {
      return fail(err);
    }
  });
}

const udidArg = { udid: z.string().optional().describe("Target simulator UDID. Defaults to the booted sim.") };

// ─── Lifecycle (simctl) ──────────────────────────────────────────────────────

tool("list_sims", "List available simulator devices (udid, name, state, runtime).", {}, async () => {
  return json(await listDevices());
});

tool(
  "boot_sim",
  "Boot a simulator. Defaults to the already-booted sim, else the first available iPhone.",
  { ...udidArg },
  async ({ udid }) => {
    const device = await bootSim(udid);
    return json(device);
  },
);

tool(
  "install_app",
  "Install a built .app bundle onto the simulator.",
  { app_path: z.string().describe("Absolute path to the .app bundle."), ...udidArg },
  async ({ app_path, udid }) => {
    const target = await resolveUdid(udid);
    await installApp(target, app_path);
    return ok(`Installed ${app_path} on ${target}`);
  },
);

tool(
  "launch",
  "Launch an installed app by bundle id. Returns the launch output (pid).",
  { bundle_id: z.string(), ...udidArg },
  async ({ bundle_id, udid }) => {
    const target = await resolveUdid(udid);
    return ok(await launchApp(target, bundle_id));
  },
);

tool(
  "terminate",
  "Terminate a running app by bundle id.",
  { bundle_id: z.string(), ...udidArg },
  async ({ bundle_id, udid }) => {
    const target = await resolveUdid(udid);
    await terminateApp(target, bundle_id);
    return ok(`Terminated ${bundle_id}`);
  },
);

tool(
  "reset_app",
  "Uninstall then reinstall an app for a clean state.",
  { bundle_id: z.string(), app_path: z.string(), ...udidArg },
  async ({ bundle_id, app_path, udid }) => {
    const target = await resolveUdid(udid);
    await uninstallApp(target, bundle_id).catch(() => undefined);
    await installApp(target, app_path);
    return ok(`Reinstalled ${bundle_id} from ${app_path}`);
  },
);

tool(
  "deeplink",
  "Open a URL / universal link in the simulator (jump straight to a screen).",
  { url: z.string(), ...udidArg },
  async ({ url, udid }) => {
    const target = await resolveUdid(udid);
    await openUrl(target, url);
    return ok(`Opened ${url}`);
  },
);

tool(
  "set_permission",
  "Grant/revoke/reset a privacy permission for an app (e.g. photos, camera, location, notifications).",
  {
    action: z.enum(["grant", "revoke", "reset"]),
    service: z.string().describe("e.g. all, photos, camera, location, notifications, contacts, microphone"),
    bundle_id: z.string(),
    ...udidArg,
  },
  async ({ action, service, bundle_id, udid }) => {
    const target = await resolveUdid(udid);
    await setPrivacy(target, action, service, bundle_id);
    return ok(`${action} ${service} for ${bundle_id}`);
  },
);

// ─── Perception ──────────────────────────────────────────────────────────────

tool(
  "describe_ui",
  "PRIMARY PERCEPTION. Return the accessibility tree of the current screen as a list of elements (label, type, value, enabled, frame). Reason over this and tap by label.",
  { interactive_only: z.boolean().optional().describe("If true, return only elements that have a label."), ...udidArg },
  async ({ interactive_only, udid }) => {
    const target = await resolveUdid(udid);
    const elements = await describeUi(target);
    // Drop zero-area nodes (off-screen / structural) — they can't be tapped and
    // only inflate the tree the agent must read each loop step. interactive_only
    // narrows further to labeled elements. tap-by-label still sees the full tree
    // (it calls describeUi directly), so this trims the agent view only.
    const visible = elements.filter((e) => e.frame && e.frame.width > 0 && e.frame.height > 0);
    const filtered = interactive_only ? visible.filter((e) => e.label) : visible;
    // Compact JSON (not pretty-printed) — fewer tokens per observation.
    return ok(JSON.stringify({ count: filtered.length, total: elements.length, elements: filtered }));
  },
);

tool(
  "screenshot",
  "Capture a PNG screenshot of the current screen. Use as the vision fallback when an element is not exposed in the accessibility tree, or to verify state.",
  { ...udidArg },
  async ({ udid }) => {
    const target = await resolveUdid(udid);
    const png = await screenshot(target);
    return { content: [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }] };
  },
);

// ─── Actions (idb) ───────────────────────────────────────────────────────────

tool(
  "tap",
  "Tap an element by accessibility label (preferred) or by raw x,y coordinate (fallback). Provide either `label` or both `x` and `y`.",
  {
    label: z.string().optional().describe("Accessibility label to match (exact, then case-insensitive, then substring)."),
    x: z.number().optional(),
    y: z.number().optional(),
    ...udidArg,
  },
  async ({ label, x, y, udid }) => {
    const target = await resolveUdid(udid);
    if (label != null) {
      const elements = await describeUi(target);
      const match = findByLabel(elements, label);
      if (!match) {
        const hints = nearestLabels(elements, label);
        return fail(
          `No element matching label "${label}". Nearest labels on screen: ${
            hints.length ? hints.map((h) => `"${h}"`).join(", ") : "(none with labels)"
          }`,
        );
      }
      await tap(target, match.center.x, match.center.y);
      return json({ mode: "label", tapped: match.element, at: match.center });
    }
    if (x != null && y != null) {
      await tap(target, x, y);
      return json({ mode: "coordinate", at: { x, y } });
    }
    return fail("Provide either `label`, or both `x` and `y`.");
  },
);

tool(
  "type_text",
  "Type text into the currently focused field. Tap the field first to focus it.",
  { text: z.string(), ...udidArg },
  async ({ text, udid }) => {
    const target = await resolveUdid(udid);
    await typeText(target, text);
    return ok(`Typed ${text.length} chars`);
  },
);

tool(
  "swipe",
  "Swipe/scroll from one point to another. Either give a `direction` (auto-computed from screen center) or explicit from/to coordinates.",
  {
    direction: z.enum(["up", "down", "left", "right"]).optional(),
    from_x: z.number().optional(),
    from_y: z.number().optional(),
    to_x: z.number().optional(),
    to_y: z.number().optional(),
    duration_sec: z.number().optional(),
    ...udidArg,
  },
  async ({ direction, from_x, from_y, to_x, to_y, duration_sec, udid }) => {
    const target = await resolveUdid(udid);
    let from: { x: number; y: number };
    let to: { x: number; y: number };
    if (direction) {
      // Use a conservative central swipe; pixel space is the sim's logical points.
      const cx = 200, cy = 420, d = 280;
      const map = {
        up: [{ x: cx, y: cy + d }, { x: cx, y: cy - d }],
        down: [{ x: cx, y: cy - d }, { x: cx, y: cy + d }],
        left: [{ x: cx + d, y: cy }, { x: cx - d, y: cy }],
        right: [{ x: cx - d, y: cy }, { x: cx + d, y: cy }],
      } as const;
      [from, to] = map[direction];
    } else if ([from_x, from_y, to_x, to_y].every((n) => n != null)) {
      from = { x: from_x!, y: from_y! };
      to = { x: to_x!, y: to_y! };
    } else {
      return fail("Provide either `direction`, or all of from_x/from_y/to_x/to_y.");
    }
    await swipe(target, from, to, duration_sec);
    return json({ from, to });
  },
);

tool(
  "press_button",
  "Press a hardware button (HOME backgrounds the app; LOCK locks the screen).",
  { button: z.enum(["HOME", "LOCK", "SIDE_BUTTON", "SIRI", "APPLE_PAY"]), ...udidArg },
  async ({ button, udid }) => {
    const target = await resolveUdid(udid);
    await pressButton(target, button as HardwareButton);
    return ok(`Pressed ${button}`);
  },
);

// ─── Boot ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe; stdout is the MCP channel.
  process.stderr.write("ios-agent-driver MCP server running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
