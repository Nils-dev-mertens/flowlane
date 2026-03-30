import * as p from '@clack/prompts';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { container } from '../container';
import { TOKENS } from '../tokens';
import type { IPRService }     from '../services/interfaces/IPRService';
import type { IConfigService } from '../services/interfaces/IConfigService';
import { runHook }             from '../utils/hooks';

export interface PrCommentOptions {
  file?: string;
  line?: number;
  endLine?: number;
}

export async function prCommentCommand(comment: string, options: PrCommentOptions = {}): Promise<void> {
  // Resolve current branch.
  let branch: string;
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    throw new Error('Could not determine current git branch.');
  }

  const prSvc = container.resolve<IPRService>(TOKENS.PRService);
  const cfg   = container.resolve<IConfigService>(TOKENS.ConfigService);

  const spinner = p.spinner();
  spinner.start(`Looking for an open PR on branch "${chalk.cyan(branch)}"…`);

  const pr = await prSvc.findPRForBranch(branch);
  if (!pr) {
    spinner.stop(chalk.red('No open PR found for the current branch.'));
    return;
  }

  spinner.stop(`Found PR: ${chalk.cyan(pr.title)}`);

  const commentOptions = options.file
    ? { filePath: options.file, startLine: options.line, endLine: options.endLine }
    : undefined;

  await prSvc.addComment(pr.id, comment, commentOptions);

  const location = options.file
    ? ` on ${chalk.dim(options.file)}${options.line ? chalk.dim(`:${options.line}`) : ''}`
    : '';
  p.outro(`${chalk.green('✓')} Comment added to PR #${pr.id}${location}`);

  runHook(cfg.get<string>('hookAfterComment'), { prId: String(pr.id), branch });
}
