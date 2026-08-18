import * as p from '@clack/prompts';
import chalk from 'chalk';
import { errMsg } from '../utils/errors';
import { container }   from '../container';
import { TOKENS }      from '../tokens';
import type { IPRService }   from '../services/interfaces/IPRService';
import type { MergeStrategy, PRCheckStatus } from '../types';
import { resolvePRId }        from '../utils/prResolve';
import { safeSpinner }        from '../utils/tty';
import { formatChecks }       from '../utils/prDisplay';

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
  const fetchSpinner = safeSpinner();
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

  const checkStatus = await loadCheckStatus(prSvc, id);
  if (checkStatus && (checkStatus.state === 'failure' || checkStatus.state === 'error')) {
    p.log.warn(`${chalk.red('Checks are failing:')} ${formatChecks(checkStatus)}`);
  }

  const confirmed = await p.confirm({
    message: `Complete PR #${chalk.cyan(id)} using ${chalk.yellow(strategy)}?`,
    initialValue: true,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.outro(chalk.dim('Cancelled.'));
    return;
  }

  const spinner = safeSpinner();
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

/** Fetch CI check status, tolerating providers that cannot report it. */
async function loadCheckStatus(prSvc: IPRService, prId: number): Promise<PRCheckStatus | null> {
  const spinner = safeSpinner();
  spinner.start('Checking CI status…');
  try {
    const status = await prSvc.getCheckStatus(prId);
    spinner.stop(status ? formatChecks(status) : chalk.dim('No check status available.'));
    return status;
  } catch (err: unknown) {
    spinner.stop(chalk.dim('Could not fetch check status.'));
    return null;
  }
}
