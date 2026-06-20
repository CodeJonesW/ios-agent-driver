import { execFile } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * A command that failed. Carries the invoked command line, exit code, and
 * stderr so callers can surface a precise, actionable error rather than a
 * swallowed generic failure.
 */
export class CommandError extends Error {
  constructor(
    public readonly command: string,
    public readonly code: number | null,
    public readonly stderr: string,
  ) {
    super(`\`${command}\` exited ${code ?? "?"}: ${stderr.trim() || "(no stderr)"}`);
    this.name = "CommandError";
  }
}

const MAX_BUFFER = 64 * 1024 * 1024;

/** Run a command and return its text output. Rejects with CommandError on failure. */
export function run(
  file: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: opts.timeoutMs ?? 60_000, maxBuffer: MAX_BUFFER, encoding: "buffer" },
      (err, stdout, stderr) => {
        const out = (stdout as Buffer).toString("utf8");
        const errOut = (stderr as Buffer).toString("utf8");
        if (err) {
          const code = (err as NodeJS.ErrnoException).code;
          const exit = typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : null;
          if (code === "ENOENT") {
            return reject(new CommandError(`${file} ${args.join(" ")}`, null, `command not found: ${file}`));
          }
          return reject(new CommandError(`${file} ${args.join(" ")}`, exit, errOut || err.message));
        }
        resolve({ stdout: out, stderr: errOut });
      },
    );
  });
}

/** Run a command and return its raw stdout bytes (for screenshots etc.). */
export function runBinary(
  file: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: opts.timeoutMs ?? 60_000, maxBuffer: MAX_BUFFER, encoding: "buffer" },
      (err, stdout, stderr) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            return reject(new CommandError(`${file} ${args.join(" ")}`, null, `command not found: ${file}`));
          }
          const exit = typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : null;
          return reject(new CommandError(`${file} ${args.join(" ")}`, exit, (stderr as Buffer).toString("utf8") || err.message));
        }
        resolve(stdout as Buffer);
      },
    );
  });
}
