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
