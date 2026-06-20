import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./exec.js";

export interface SimDevice {
  udid: string;
  name: string;
  state: string;
  runtime: string;
}

/** All available (non-deleted) simulator devices, across runtimes. */
export async function listDevices(): Promise<SimDevice[]> {
  const { stdout } = await run("xcrun", ["simctl", "list", "devices", "--json"]);
  const data = JSON.parse(stdout) as { devices: Record<string, Array<Record<string, unknown>>> };
  const out: SimDevice[] = [];
  for (const runtime of Object.keys(data.devices)) {
    for (const d of data.devices[runtime]) {
      if (d.isAvailable === false) continue;
      out.push({
        udid: String(d.udid),
        name: String(d.name),
        state: String(d.state),
        runtime: runtime.replace("com.apple.CoreSimulator.SimRuntime.", ""),
      });
    }
  }
  return out;
}

/** UDID of the currently booted simulator, or null if none. */
export async function bootedUdid(): Promise<string | null> {
  const devices = await listDevices();
  return devices.find((d) => d.state === "Booted")?.udid ?? null;
}

/**
 * Resolve the target UDID: explicit arg wins; otherwise the booted sim.
 * Throws loudly if nothing is booted and no udid was supplied — no silent guess.
 */
export async function resolveUdid(udid?: string): Promise<string> {
  if (udid) return udid;
  const booted = await bootedUdid();
  if (booted) return booted;
  throw new Error(
    "No booted simulator and no `udid` provided. Boot one with the boot_sim tool, or pass a udid (see list_sims).",
  );
}

/** Boot a simulator. Defaults to the already-booted one, else the first available iPhone. */
export async function bootSim(udid?: string): Promise<SimDevice> {
  const devices = await listDevices();
  let target = udid
    ? devices.find((d) => d.udid === udid)
    : devices.find((d) => d.state === "Booted") ?? devices.find((d) => /iPhone/i.test(d.name));
  if (!target) {
    throw new Error(
      udid ? `No available simulator with udid ${udid}.` : "No available iPhone simulator found.",
    );
  }
  if (target.state !== "Booted") {
    await run("xcrun", ["simctl", "boot", target.udid], { timeoutMs: 120_000 });
    target = { ...target, state: "Booted" };
  }
  return target;
}

export async function installApp(udid: string, appPath: string): Promise<void> {
  await run("xcrun", ["simctl", "install", udid, appPath], { timeoutMs: 120_000 });
}

export async function uninstallApp(udid: string, bundleId: string): Promise<void> {
  await run("xcrun", ["simctl", "uninstall", udid, bundleId]);
}

export async function launchApp(udid: string, bundleId: string): Promise<string> {
  const { stdout } = await run("xcrun", ["simctl", "launch", udid, bundleId], { timeoutMs: 90_000 });
  return stdout.trim();
}

export async function terminateApp(udid: string, bundleId: string): Promise<void> {
  await run("xcrun", ["simctl", "terminate", udid, bundleId]);
}

export async function openUrl(udid: string, url: string): Promise<void> {
  await run("xcrun", ["simctl", "openurl", udid, url]);
}

/** Grant or revoke a privacy permission (e.g. photos, camera, notifications, location). */
export async function setPrivacy(
  udid: string,
  action: "grant" | "revoke" | "reset",
  service: string,
  bundleId: string,
): Promise<void> {
  await run("xcrun", ["simctl", "privacy", udid, action, service, bundleId]);
}

/** Capture a PNG screenshot of the simulator and return the bytes. */
export async function screenshot(udid: string): Promise<Buffer> {
  const file = join(tmpdir(), `ios-agent-driver-${process.pid}-${Date.now()}.png`);
  try {
    await run("xcrun", ["simctl", "io", udid, "screenshot", "--type=png", file]);
    return await readFile(file);
  } finally {
    await unlink(file).catch(() => undefined);
  }
}
