import chalk from 'chalk';
import { execSync } from 'child_process';
import type { PRFile, PRSummary, PRThread } from '../types';

/** Print a comment thread with a stable index label and its comments. */
export function printThread(thread: PRThread, index: number): void {
  const location = thread.filePath
    ? chalk.cyan(thread.filePath) + (thread.startLine ? chalk.dim(`:${thread.startLine}`) : '')
    : chalk.dim('General comment');

  const statusBadge = thread.status === 'pending' ? chalk.yellow(' [pending]') : '';

  console.log(`\n  ${chalk.bold(`Thread #${index}`)}  ·  ${location}${statusBadge}`);
  console.log('  ' + chalk.dim('─'.repeat(58)));

  thread.comments.forEach((comment, i) => {
    const isFirst = i === 0;
    const age     = formatAge(comment.publishedAt);
    const author  = isFirst ? chalk.bold(comment.author) : chalk.dim(comment.author);
    const content = wrapText(comment.content, 56);

    if (!isFirst) console.log('');
    console.log(`  ${author}  ${chalk.dim(age)}`);
    content.forEach((line) => console.log(`  ${line}`));
  });
}

/** Word-wrap text to a width, preserving existing newlines. */
export function wrapText(text: string, width: number): string[] {
  return text.split('\n').flatMap((line) => {
    if (line.length <= width) return [line];
    const words = line.split(' ');
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

/** Format a timestamp as a short relative age (e.g. "3h ago"). */
export function formatAge(date: Date): string {
  const diff  = Date.now() - date.getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (days > 0)  return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  return `${mins}m ago`;
}

/** Format reviewer votes as a compact, colorized list. */
export function formatReviewers(reviewers: PRSummary['reviewers']): string {
  if (reviewers.length === 0) return '';
  return reviewers.map((r) => {
    const name = r.name.split(' ')[0];
    if (r.vote === 10)  return chalk.green(`✓ ${name}`);
    if (r.vote === 5)   return chalk.yellow(`~ ${name}`);
    if (r.vote === -5)  return chalk.yellow(`⏸ ${name}`);
    if (r.vote === -10) return chalk.red(`✗ ${name}`);
    return chalk.dim(`○ ${name}`);
  }).join(chalk.dim('  ·  '));
}

/** Color badge for a file change type. */
export function changeTypeBadge(type: PRFile['changeType']): string {
  switch (type) {
    case 'add':    return chalk.green('+');
    case 'edit':   return chalk.yellow('~');
    case 'delete': return chalk.red('-');
    case 'rename': return chalk.blue('→');
    default:       return chalk.dim('?');
  }
}

/** Print a colorized diff for a changed file, falling back to local git. */
export function showDiff(file: PRFile, pr?: PRSummary): void {
  if (file.changeType === 'delete') {
    console.log(`\n  ${chalk.red('File was deleted.')} No diff to show.\n`);
    return;
  }

  const target = pr?.targetBranch ?? 'HEAD~1';
  const source = pr?.sourceBranch ?? 'HEAD';

  let diff: string;
  try {
    diff = execSync(
      `git diff "origin/${target}"..."origin/${source}" -- "${file.path}" 2>/dev/null || ` +
      `git diff "${target}"..."${source}" -- "${file.path}" 2>/dev/null || ` +
      `git diff HEAD -- "${file.path}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
  } catch {
    diff = '';
  }

  if (!diff.trim()) {
    console.log(chalk.dim(`\n  No local diff available for ${file.path}.\n`));
    return;
  }

  console.log(`\n  ${chalk.bold(file.path)}`);
  console.log('  ' + chalk.dim('─'.repeat(60)));

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      console.log('  ' + chalk.dim(line));
    } else if (line.startsWith('+')) {
      console.log('  ' + chalk.green(line));
    } else if (line.startsWith('-')) {
      console.log('  ' + chalk.red(line));
    } else if (line.startsWith('@@')) {
      console.log('  ' + chalk.cyan(line));
    } else {
      console.log('  ' + line);
    }
  }
  console.log('');
}
