import * as p from '@clack/prompts';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { container } from '../container';
import { TOKENS } from '../tokens';
import type { IPRService }     from '../services/interfaces/IPRService';
import type { IConfigService } from '../services/interfaces/IConfigService';
import { runHook }             from '../utils/hooks';
import { resolvePRId }         from '../utils/prResolve';

export interface PrCommentOptions {
  file?: string;
  line?: number;
  endLine?: number;
}

/**
 * Add a comment to a pull request.
 *
 * - If `prId` is provided it targets that PR directly (no branch dependency),
 *   which also allows commenting on PRs you are not currently checked out on.
 * - Otherwise the current git branch is used to look up its open PR.
 */
export async function prCommentCommand(
  comment: string,
  prId?: string,
  options: PrCommentOptions = {},
): Promise<void> {
  const prSvc = container.resolve<IPRService>(TOKENS.PRService);
  const cfg   = container.resolve<IConfigService>(TOKENS.ConfigService);

  const id = await resolvePRId(prSvc, prId);
  const pr = await prSvc.getPR(id);

  const commentOptions = options.file
    ? { filePath: options.file, startLine: options.line, endLine: options.endLine }
    : undefined;

  await prSvc.addComment(pr.id, comment, commentOptions);

  const location = options.file
    ? ` on ${chalk.dim(options.file)}${options.line ? chalk.dim(`:${options.line}`) : ''}`
    : '';
  p.outro(`${chalk.green('✓')} Comment added to PR #${pr.id}${location}`);

  let branch = '';
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch { /* not in a git repo */ }

  runHook(cfg.get<string>('hookAfterComment'), { prId: String(pr.id), branch });
}
