import * as p from '@clack/prompts';
import chalk from 'chalk';
import { errMsg } from '../utils/errors';
import { container }   from '../container';
import { TOKENS }      from '../tokens';
import { isInteractive } from '../utils/tty';
import type { IPRService } from '../services/interfaces/IPRService';
import { resolvePRId }     from '../utils/prResolve';

export async function prResolveThreadCommand(threadId: string, prId?: string): Promise<void> {
  const interactive = isInteractive();
  const prSvc       = container.resolve<IPRService>(TOKENS.PRService);

  if (interactive) {
    p.intro(chalk.bgCyan.black('  flowlane pr threads resolve  '));
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
    const spinner = p.spinner();
    spinner.start(`Resolving thread #${chalk.cyan(tid)} on PR #${chalk.cyan(id)}…`);
    try {
      await prSvc.resolveThread(id, tid);
      spinner.stop(chalk.green(`Thread #${tid} resolved.`));
    } catch (err: unknown) {
      spinner.stop(chalk.red('Failed to resolve thread.'));
      throw new Error(errMsg(err));
    }
    p.outro(chalk.dim('Run  flowlane pr threads  to confirm.'));
  } else {
    try {
      await prSvc.resolveThread(id, tid);
      process.stdout.write(`Thread #${tid} on PR #${id} resolved.\n`);
    } catch (err: unknown) {
      process.stderr.write(`Error: ${errMsg(err)}\n`);
      process.exit(1);
    }
  }
}
