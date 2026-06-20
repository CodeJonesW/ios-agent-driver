import { CommandError, run } from "./exec.js";
import { normalize, type UIElement } from "./ax.js";

export class IdbUnavailableError extends Error {
  constructor(detail: string) {
    super(
      `idb is required for UI perception/actions but is unavailable: ${detail}\n` +
        "Install it with:\n" +
        "  brew install idb-companion\n" +
        "  pip3 install fb-idb\n" +
        "Then confirm with: idb list-targets",
    );
    this.name = "IdbUnavailableError";
  }
}

/** Verify idb is installed and can see the target. Throws a remediation error otherwise. */
export async function ensureIdb(udid: string): Promise<void> {
  try {
    const { stdout } = await run("idb", ["list-targets", "--json"]);
    const lines = stdout.trim().split("\n").filter(Boolean);
    const targets = lines.map((l) => JSON.parse(l) as { udid?: string });
    if (!targets.some((t) => t.udid === udid)) {
      // Not connected yet — idb auto-connects booted sims on first command, so
      // this is informational, not fatal. We let the actual command try.
    }
  } catch (err) {
    if (err instanceof CommandError && /command not found/.test(err.stderr)) {
      throw new IdbUnavailableError("`idb` is not on PATH");
    }
    throw err;
  }
}

/** Full accessibility tree of the current screen, normalized. */
export async function describeUi(udid: string): Promise<UIElement[]> {
  await ensureIdb(udid);
  let stdout: string;
  try {
    ({ stdout } = await run("idb", ["ui", "describe-all", "--udid", udid, "--json"]));
  } catch (err) {
    if (err instanceof CommandError && /command not found/.test(err.stderr)) {
      throw new IdbUnavailableError("`idb` is not on PATH");
    }
    throw err;
  }
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
  await run("idb", ["ui", "tap", "--udid", udid, String(x), String(y)]);
}

export async function typeText(udid: string, text: string): Promise<void> {
  await run("idb", ["ui", "text", "--udid", udid, text]);
}

export async function swipe(
  udid: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  durationSec?: number,
): Promise<void> {
  const args = ["ui", "swipe", "--udid", udid, String(from.x), String(from.y), String(to.x), String(to.y)];
  if (durationSec != null) args.push("--duration", String(durationSec));
  await run("idb", args);
}

export type HardwareButton = "HOME" | "LOCK" | "SIDE_BUTTON" | "SIRI" | "APPLE_PAY";

export async function pressButton(udid: string, button: HardwareButton): Promise<void> {
  await run("idb", ["ui", "button", "--udid", udid, button]);
}
