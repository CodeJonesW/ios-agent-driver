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

/** Verify idb is installed and can see the target. Throws a remediation error otherwise. */
export async function ensureIdb(udid: string): Promise<void> {
  const { stdout } = await idbRun(["list-targets", "--json"]);
  const lines = stdout.trim().split("\n").filter(Boolean);
  let targets: Array<{ udid?: string }> = [];
  try {
    targets = lines.map((l) => JSON.parse(l) as { udid?: string });
  } catch {
    // Non-JSON output (idb version drift) — not fatal; let the actual command try.
    return;
  }
  if (!targets.some((t) => t.udid === udid)) {
    // Not connected yet — idb auto-connects booted sims on first command, so
    // this is informational, not fatal. We let the actual command try.
  }
}

/** Full accessibility tree of the current screen, normalized. */
export async function describeUi(udid: string): Promise<UIElement[]> {
  await ensureIdb(udid);
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
