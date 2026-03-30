import * as p from '@clack/prompts';
import chalk from 'chalk';
import { execSync } from 'child_process';
import type { IPRService } from '../services/interfaces/IPRService';

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

  const spinner = p.spinner();
  spinner.start(`Finding PR for branch "${chalk.cyan(branch)}"…`);

  const pr = await prSvc.findPRForBranch(branch);
  if (!pr) {
    spinner.stop(chalk.red(`No open PR found for branch "${branch}".`));
    throw new Error(`No open PR found for branch "${branch}".`);
  }

  spinner.stop(`PR #${chalk.cyan(pr.id)} — ${chalk.dim(pr.title)}`);
  return Number(pr.id);
}
