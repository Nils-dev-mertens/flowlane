import chalk from 'chalk';
import { execSync } from 'child_process';

/**
 * Run a user-configured post-action hook command.
 *
 * Placeholders in the form {{varName}} are replaced with values from `vars`.
 * If the command fails the error is printed as a warning — the main action is
 * never rolled back because of a failing hook.
 */
export function runHook(command: string | undefined, vars: Record<string, string> = {}): void {
  if (!command) return;

  const cmd = command.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');

  console.log(chalk.dim(`\n↳ hook: ${cmd}`));
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(chalk.yellow(`  Hook exited with an error (continuing): ${msg}`));
  }
}
