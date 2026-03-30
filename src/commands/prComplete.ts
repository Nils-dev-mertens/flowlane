import * as p from '@clack/prompts';
import chalk from 'chalk';
import { container }   from '../container';
import { TOKENS }      from '../tokens';
import type { IPRService }   from '../services/interfaces/IPRService';
import type { MergeStrategy } from '../types';
import { resolvePRId }        from '../utils/prResolve';

const STRATEGY_OPTIONS: Array<{ value: MergeStrategy; label: string; hint: string }> = [
  { value: 'squash',       label: 'Squash commit',       hint: 'Combine all commits into one' },
  { value: 'merge',        label: 'Merge commit',        hint: 'Preserve full commit history' },
  { value: 'rebase',       label: 'Rebase',              hint: 'Replay commits on top of target' },
  { value: 'rebase-merge', label: 'Rebase + merge commit', hint: 'Rebase then add a merge commit' },
];

/**
 * Complete (merge) a pull request after confirming the merge strategy.
 */
export async function prCompleteCommand(prId?: string): Promise<void> {
  p.intro(chalk.bgCyan.black('  flowlane pr complete  '));

  const prSvc = container.resolve<IPRService>(TOKENS.PRService);

  let id: number;
  try {
    id = await resolvePRId(prSvc, prId);
  } catch (err: unknown) {
    p.outro(chalk.red(errMsg(err)));
    process.exit(1);
  }

  // Show PR title for context before asking strategy.
  const fetchSpinner = p.spinner();
  fetchSpinner.start(`Fetching PR #${chalk.cyan(id)}…`);
  let prTitle = `PR #${id}`;
  try {
    const pr = await prSvc.getPR(id);
    prTitle = pr.title;
    fetchSpinner.stop(`${chalk.bold(prTitle)}`);
  } catch {
    fetchSpinner.stop(chalk.dim(`PR #${id}`));
  }

  const picked = await p.select({
    message: 'Merge strategy:',
    options: STRATEGY_OPTIONS,
  });

  if (p.isCancel(picked)) {
    p.outro(chalk.dim('Cancelled.'));
    return;
  }

  const strategy = picked as MergeStrategy;

  const confirmed = await p.confirm({
    message: `Complete PR #${chalk.cyan(id)} using ${chalk.yellow(strategy)}?`,
    initialValue: true,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.outro(chalk.dim('Cancelled.'));
    return;
  }

  const spinner = p.spinner();
  spinner.start('Completing pull request…');
  try {
    await prSvc.completePR(id, strategy);
    spinner.stop(`${chalk.green('✓')} PR #${chalk.cyan(id)} completed.`);
  } catch (err: unknown) {
    spinner.stop(chalk.red('Failed to complete PR.'));
    throw new Error(errMsg(err));
  }

  p.outro(chalk.green('Done.'));
}

// ── helpers ───────────────────────────────────────────────────────────────────

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
