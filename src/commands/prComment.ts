import * as p from '@clack/prompts';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { container } from '../container';
import { TOKENS } from '../tokens';
import type { IPRService } from '../services/interfaces/IPRService';

export async function prCommentCommand(comment: string): Promise<void> {
  // Resolve current branch.
  let branch: string;
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    throw new Error('Could not determine current git branch.');
  }

  const prSvc = container.resolve<IPRService>(TOKENS.PRService);

  const spinner = p.spinner();
  spinner.start(`Looking for an open PR on branch "${chalk.cyan(branch)}"…`);

  const pr = await prSvc.findPRForBranch(branch);
  if (!pr) {
    spinner.stop(chalk.red('No open PR found for the current branch.'));
    return;
  }

  spinner.stop(`Found PR: ${chalk.cyan(pr.title)}`);

  await prSvc.addComment(pr.id, comment);

  p.outro(`${chalk.green('✓')} Comment added to PR #${pr.id}`);
}
