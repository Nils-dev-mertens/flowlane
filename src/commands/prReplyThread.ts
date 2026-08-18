import * as p from '@clack/prompts';
import chalk from 'chalk';
import { errMsg } from '../utils/errors';
import { container }   from '../container';
import { TOKENS }      from '../tokens';
import { isInteractive, safeSpinner } from '../utils/tty';
import type { IPRService } from '../services/interfaces/IPRService';
import { resolvePRId }     from '../utils/prResolve';

export async function prReplyThreadCommand(
  threadId: string,
  comment: string,
  prId?: string,
): Promise<void> {
  const interactive = isInteractive();
  const prSvc       = container.resolve<IPRService>(TOKENS.PRService);

  if (interactive) {
    p.intro(chalk.bgCyan.black('  flowlane pr threads reply  '));
  }

  let id: number;
  try {
    id = await resolvePRId(prSvc, prId);
  } catch (err: unknown) {
    if (interactive) p.outro(chalk.red(errMsg(err)));
    else process.stderr.write(`Error: ${errMsg(err)}\n`);
    process.exit(1);
  }

  const tid = Number(threadId);
  if (isNaN(tid)) {
    const msg = `Invalid thread ID: "${threadId}". Must be a number.`;
    if (interactive) p.outro(chalk.red(msg));
    else process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }

  if (interactive) {
    const spinner = safeSpinner();
    spinner.start(`Replying to thread #${chalk.cyan(tid)} on PR #${chalk.cyan(id)}…`);
    try {
      await prSvc.replyToThread(id, tid, comment);
      spinner.stop(chalk.green(`Reply added to thread #${tid}.`));
    } catch (err: unknown) {
      spinner.stop(chalk.red('Failed to post reply.'));
      throw new Error(errMsg(err));
    }
    p.outro(chalk.dim('Run  flowlane pr threads  to view the thread.'));
  } else {
    try {
      await prSvc.replyToThread(id, tid, comment);
      process.stdout.write(`Reply added to thread #${tid} on PR #${id}.\n`);
    } catch (err: unknown) {
      process.stderr.write(`Error: ${errMsg(err)}\n`);
      process.exit(1);
    }
  }
}
