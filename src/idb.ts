import { CommandError, run, type ExecResult } from "./exec.js";
import { normalize, type UIElement } from "./ax.js";

export class IdbUnavailableError extends Error {
  constructor(detail: string) {
    super(
      `idb is required for UI perception/actions but is unavailable: ${detail}\n` +
        "Install it with:\n" +
        "  brew tap facebook/fb\n" +
        "  brew install facebook/fb/idb-companion   # source build — needs up-to-date Xcode Command Line Tools\n" +
        "  pip3 install fb-idb                       # the `idb` CLI (use pipx or a venv if pip is externally-managed)\n" +
        "Then confirm with: idb list-targets\n" +
        "If the companion build fails with “Command Line Tools are too outdated”, update them via " +
        "System Settings › Software Update (or `sudo rm -rf /Library/Developer/CommandLineTools && xcode-select --install`).",
    );
    this.name = "IdbUnavailableError";
  }
}

/**
 * Run an `idb` subcommand, converting a missing-binary failure into the
 * actionable IdbUnavailableError. Every idb call goes through here so the
 * install remediation is consistent across perception AND action tools (not
 * just describe_ui).
 */
async function idbRun(args: string[], opts?: { timeoutMs?: number }): Promise<ExecResult> {
  try {
    return await run("idb", args, opts);
  } catch (err) {
    if (err instanceof CommandError && /command not found/.test(err.stderr)) {
      throw new IdbUnavailableError("`idb` is not on PATH");
    }
    throw err;
  }
}

/**
 * Full accessibility tree of the current screen, normalized.
 *
 * No `list-targets` preflight: it costs ~0.75s (vs ~0.19s for the describe
 * itself) and its result was discarded. idb auto-connects the companion on the
 * first real command, and idbRun already converts a missing-binary failure into
 * the actionable IdbUnavailableError — so the availability check is free here.
 */
export async function describeUi(udid: string): Promise<UIElement[]> {
  const { stdout } = await idbRun(["ui", "describe-all", "--udid", udid, "--json"]);
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  // idb may emit a single JSON array or newline-delimited JSON objects.
  let raw: unknown[];
  if (trimmed.startsWith("[")) {
    raw = JSON.parse(trimmed) as unknown[];
  } else {
    raw = trimmed
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown);
  }
  return normalize(raw);
}

export async function tap(udid: string, x: number, y: number): Promise<void> {
  await idbRun(["ui", "tap", "--udid", udid, String(x), String(y)]);
}

export async function typeText(udid: string, text: string): Promise<void> {
  await idbRun(["ui", "text", "--udid", udid, text]);
}

export async function swipe(
  udid: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  durationSec?: number,
): Promise<void> {
  const args = ["ui", "swipe", "--udid", udid, String(from.x), String(from.y), String(to.x), String(to.y)];
  if (durationSec != null) args.push("--duration", String(durationSec));
  await idbRun(args);
}

export type HardwareButton = "HOME" | "LOCK" | "SIDE_BUTTON" | "SIRI" | "APPLE_PAY";

export async function pressButton(udid: string, button: HardwareButton): Promise<void> {
  await idbRun(["ui", "button", "--udid", udid, button]);
}
