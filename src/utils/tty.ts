import * as p from '@clack/prompts';

/**
 * Returns true when running in an interactive terminal where TUI prompts make sense.
 * Automatically false when stdout is piped, redirected, or CI=true/1 is set.
 */
export function isInteractive(): boolean {
  return (
    process.stdout.isTTY === true &&
    process.env['CI'] !== 'true' &&
    process.env['CI'] !== '1'
  );
}

/**
 * Spinner-like handle returned by {@link safeSpinner}. Mirrors the `@clack/prompts`
 * spinner API so it can be dropped into any existing call site.
 */
export interface SpinnerHandle {
  start(message?: string): void;
  stop(message?: string, code?: number): void;
  message(message?: string): void;
}

/**
 * Set to true once the interactive TTY fails to initialize (e.g. `uv_tty_init`
 * failing under Windows Git Bash). Once broken, every subsequent call returns a
 * plain-output spinner so the CLI never crashes on a bad TTY.
 */
let ttyBroken = false;

/**
 * Create a spinner that is safe to use in any environment.
 *
 * - When stdout is not a TTY, a plain-output spinner writes progress messages to
 *   stderr, keeping stdout machine-readable for `--json` output.
 * - When the TTY fails to initialize (Windows Git Bash `uv_tty_init` errors),
 *   the first failed operation permanently falls back to plain output instead of
 *   crashing the process with a libuv assertion.
 */
export function safeSpinner(): SpinnerHandle {
  if (ttyBroken || !isInteractive()) return plainSpinner();

  let spinner: ReturnType<typeof p.spinner> | null = null;
  try {
    spinner = p.spinner();
  } catch {
    ttyBroken = true;
    return plainSpinner();
  }

  const fallback = (): SpinnerHandle => {
    ttyBroken = true;
    return plainSpinner();
  };

  return {
    start(message) {
      if (spinner === null) { fallback().start(message); return; }
      try { spinner.start(message); }
      catch { fallback().start(message); }
    },
    stop(message, code) {
      if (spinner === null) { fallback().stop(message, code); return; }
      try { spinner.stop(message, code); }
      catch { fallback().stop(message, code); }
    },
    message(message) {
      if (spinner === null) { fallback().message(message); return; }
      try { spinner.message(message); }
      catch { fallback().message(message); }
    },
  };
}

function plainSpinner(): SpinnerHandle {
  return {
    start(message) {
      if (message) process.stderr.write(message + '\n');
    },
    stop(message) {
      if (message) process.stderr.write(message + '\n');
    },
    message(message) {
      if (message) process.stderr.write(message + '\n');
    },
  };
}
