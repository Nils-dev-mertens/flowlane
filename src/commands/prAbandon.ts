import * as p from '@clack/prompts';
import chalk from 'chalk';
import { container }   from '../container';
import { TOKENS }      from '../tokens';
import type { IPRService } from '../services/interfaces/IPRService';
import { resolvePRId }     from '../utils/prResolve';

/**
 * Abandon a pull request after confirmation.
 */
export async function prAbandonCommand(prId?: string): Promise<void> {
  p.intro(chalk.bgCyan.black('  flowlane pr abandon  '));

  const prSvc = container.resolve<IPRService>(TOKENS.PRService);

  let id: number;
  try {
    id = await resolvePRId(prSvc, prId);
  } catch (err: unknown) {
    p.outro(chalk.red(errMsg(err)));
    process.exit(1);
  }

  // Show PR title for context.
  const fetchSpinner = p.spinner();
  fetchSpinner.start(`Fetching PR #${chalk.cyan(id)}…`);
  let prTitle = `PR #${id}`;
  try {
    const pr = await prSvc.getPR(id);
    prTitle = pr.title;
    fetchSpinner.stop(chalk.bold(prTitle));
  } catch {
    fetchSpinner.stop(chalk.dim(`PR #${id}`));
  }

  const confirmed = await p.confirm({
    message: chalk.yellow(`Abandon PR #${id}? This cannot be undone.`),
    initialValue: false,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.outro(chalk.dim('Cancelled.'));
    return;
  }

  const spinner = p.spinner();
  spinner.start('Abandoning pull request…');
  try {
    await prSvc.abandonPR(id);
    spinner.stop(`${chalk.green('✓')} PR #${chalk.cyan(id)} abandoned.`);
  } catch (err: unknown) {
    spinner.stop(chalk.red('Failed to abandon PR.'));
    throw new Error(errMsg(err));
  }

  p.outro(chalk.green('Done.'));
}

// ── helpers ───────────────────────────────────────────────────────────────────

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
