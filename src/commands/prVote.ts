import * as p from '@clack/prompts';
import chalk from 'chalk';
import { container }   from '../container';
import { TOKENS }      from '../tokens';
import type { IPRService } from '../services/interfaces/IPRService';
import type { PRVote }     from '../types';
import { resolvePRId }     from '../utils/prResolve';

// ── approve (shorthand) ───────────────────────────────────────────────────────

/**
 * Directly approve a pull request without prompting for a vote choice.
 */
export async function prApproveCommand(prId?: string): Promise<void> {
  p.intro(chalk.bgCyan.black('  flowlane pr approve  '));

  const prSvc = container.resolve<IPRService>(TOKENS.PRService);

  let id: number;
  try {
    id = await resolvePRId(prSvc, prId);
  } catch (err: unknown) {
    p.outro(chalk.red(errMsg(err)));
    process.exit(1);
  }

  const spinner = p.spinner();
  spinner.start(`Approving PR #${chalk.cyan(id)}…`);
  try {
    await prSvc.votePR(id, 'approve');
    spinner.stop(`${chalk.green('✓')} PR #${chalk.cyan(id)} approved.`);
  } catch (err: unknown) {
    spinner.stop(chalk.red('Failed to approve PR.'));
    throw new Error(errMsg(err));
  }

  p.outro(chalk.green('Done.'));
}

// ── vote (interactive) ────────────────────────────────────────────────────────

const VOTE_OPTIONS: Array<{ value: PRVote; label: string; hint: string }> = [
  { value: 'approve',                  label: '✓  Approve',                  hint: 'You\'re happy to merge' },
  { value: 'approve-with-suggestions', label: '~  Approve with suggestions',  hint: 'Approve but left comments' },
  { value: 'wait',                     label: '⏸  Wait for author',           hint: 'Author needs to address feedback' },
  { value: 'reject',                   label: '✗  Reject',                    hint: 'Not ready to merge' },
  { value: 'reset',                    label: '○  Reset vote',                hint: 'Remove your current vote' },
];

/**
 * Interactively pick a reviewer vote for a pull request.
 */
export async function prVoteCommand(prId?: string): Promise<void> {
  p.intro(chalk.bgCyan.black('  flowlane pr vote  '));

  const prSvc = container.resolve<IPRService>(TOKENS.PRService);

  let id: number;
  try {
    id = await resolvePRId(prSvc, prId);
  } catch (err: unknown) {
    p.outro(chalk.red(errMsg(err)));
    process.exit(1);
  }

  const choice = await p.select({
    message: `Your vote on PR #${chalk.cyan(id)}:`,
    options: VOTE_OPTIONS,
  });

  if (p.isCancel(choice)) {
    p.outro(chalk.dim('Cancelled.'));
    return;
  }

  const vote = choice as PRVote;

  const spinner = p.spinner();
  spinner.start('Submitting vote…');
  try {
    await prSvc.votePR(id, vote);
    const label = VOTE_OPTIONS.find(o => o.value === vote)!.label.trim();
    spinner.stop(`${chalk.green('✓')} Vote submitted: ${chalk.bold(label)}`);
  } catch (err: unknown) {
    spinner.stop(chalk.red('Failed to submit vote.'));
    throw new Error(errMsg(err));
  }

  p.outro(chalk.green('Done.'));
}

// ── helpers ───────────────────────────────────────────────────────────────────

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
