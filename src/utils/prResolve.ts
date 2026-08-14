import * as p from '@clack/prompts';
import chalk from 'chalk';
import { execSync } from 'child_process';
import type { IPRService } from '../services/interfaces/IPRService';
import { isInteractive } from './tty';

/**
 * Resolve a numeric PR ID.
 *
 * - If `prId` is already provided it is used as-is (no network call).
 * - Otherwise the current git branch is detected and used to look up the
 *   open PR via the service.
 *
 * Throws a descriptive error if no PR can be found.
 */
export async function resolvePRId(
  prSvc: IPRService,
  prId?: string | number,
): Promise<number> {
  if (prId != null) return Number(prId);

  let branch: string;
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
  } catch {
    throw new Error('Not inside a git repository.');
  }

  // Only animate progress on a real terminal; scripts/JSON get plain output.
  const interactive = isInteractive();
  const spinner = interactive ? p.spinner() : null;
  spinner?.start(`Finding PR for branch "${chalk.cyan(branch)}"…`);
  if (!interactive) process.stderr.write(`Finding PR for branch "${branch}"…\n`);

  const pr = await prSvc.findPRForBranch(branch);
  if (!pr) {
    const message = `No open PR found for branch "${branch}".`;
    spinner?.stop(chalk.red(message));
    throw new Error(message);
  }

  spinner?.stop(`PR #${chalk.cyan(pr.id)} — ${chalk.dim(pr.title)}`);
  if (!interactive) process.stderr.write(`PR #${pr.id} — ${pr.title}\n`);
  return Number(pr.id);
}
