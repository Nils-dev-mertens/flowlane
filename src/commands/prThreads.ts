import * as p from '@clack/prompts';
import chalk from 'chalk';
import { container }   from '../container';
import { TOKENS }      from '../tokens';
import type { IPRService } from '../services/interfaces/IPRService';
import type { PRThread }   from '../types';
import { resolvePRId }     from '../utils/prResolve';

export interface PrThreadsOptions {
  /** Show all threads including resolved ones. Default: active/pending only. */
  all?: boolean;
}

/**
 * Display comment threads on a pull request.
 */
export async function prThreadsCommand(prId?: string, options: PrThreadsOptions = {}): Promise<void> {
  const activeOnly = !options.all;
  p.intro(
    chalk.bgCyan.black('  flowlane pr threads  ') +
    (activeOnly ? chalk.dim('  active only') : chalk.dim('  all threads')),
  );

  const prSvc = container.resolve<IPRService>(TOKENS.PRService);

  let id: number;
  try {
    id = await resolvePRId(prSvc, prId);
  } catch (err: unknown) {
    p.outro(chalk.red(errMsg(err)));
    process.exit(1);
  }

  const spinner = p.spinner();
  spinner.start(`Loading threads for PR #${chalk.cyan(id)}…`);

  let threads: PRThread[];
  try {
    threads = await prSvc.getThreads(id, activeOnly);
    spinner.stop(
      threads.length > 0
        ? `${threads.length} thread${threads.length !== 1 ? 's' : ''} found.`
        : chalk.dim('No threads found.'),
    );
  } catch (err: unknown) {
    spinner.stop(chalk.red('Failed to load threads.'));
    throw new Error(errMsg(err));
  }

  if (threads.length === 0) {
    p.outro(
      activeOnly
        ? chalk.dim('No active comment threads. Run with --all to include resolved threads.')
        : chalk.dim('No comment threads on this PR.'),
    );
    return;
  }

  threads.forEach((thread, i) => printThread(thread, i + 1));

  p.outro(
    activeOnly
      ? chalk.dim('Run with --all to include resolved threads.')
      : chalk.dim(`${threads.length} thread${threads.length !== 1 ? 's' : ''} shown.`),
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────

function printThread(thread: PRThread, index: number): void {
  const location = thread.filePath
    ? chalk.cyan(thread.filePath) + (thread.startLine ? chalk.dim(`:${thread.startLine}`) : '')
    : chalk.dim('General comment');

  const statusBadge = thread.status === 'pending'
    ? chalk.yellow(' [pending]')
    : '';

  console.log(`\n  ${chalk.bold(`Thread #${index}`)}  ·  ${location}${statusBadge}`);
  console.log('  ' + chalk.dim('─'.repeat(58)));

  thread.comments.forEach((comment, i) => {
    const isFirst  = i === 0;
    const age      = formatAge(comment.publishedAt);
    const author   = isFirst ? chalk.bold(comment.author) : chalk.dim(comment.author);
    const content  = wrapText(comment.content, 56);

    if (!isFirst) console.log('');
    console.log(`  ${author}  ${chalk.dim(age)}`);
    content.forEach(line => console.log(`  ${line}`));
  });
}

function wrapText(text: string, width: number): string[] {
  // Preserve existing newlines, then word-wrap long lines.
  return text.split('\n').flatMap(line => {
    if (line.length <= width) return [line];
    const words: string[] = line.split(' ');
    const wrapped: string[] = [];
    let current = '';
    for (const word of words) {
      if ((current + ' ' + word).trimStart().length > width) {
        if (current) wrapped.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) wrapped.push(current);
    return wrapped;
  });
}

function formatAge(date: Date): string {
  const diff  = Date.now() - date.getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (days > 0)  return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  return `${mins}m ago`;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
