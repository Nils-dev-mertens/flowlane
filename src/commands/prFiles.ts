import * as p from '@clack/prompts';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { container }      from '../container';
import { TOKENS }         from '../tokens';
import { isInteractive }  from '../utils/tty';
import type { IPRService } from '../services/interfaces/IPRService';
import type { PRFile, PRSummary } from '../types';
import { resolvePRId }    from '../utils/prResolve';

export interface PrFilesOptions {
  json?: boolean;
}

/**
 * Interactive file-by-file PR review.
 * Shows changed files, lets the user view diffs and post inline comments.
 * In non-interactive / --json mode, just lists the changed files.
 */
export async function prFilesCommand(prId?: string, options: PrFilesOptions = {}): Promise<void> {
  const interactive = isInteractive() && !options.json;
  const prSvc       = container.resolve<IPRService>(TOKENS.PRService);

  if (interactive) p.intro(chalk.bgCyan.black('  flowlane pr files  '));

  let id: number;
  try {
    id = await resolvePRId(prSvc, prId);
  } catch (err: unknown) {
    if (interactive) { p.outro(chalk.red(errMsg(err))); }
    else { process.stderr.write(`Error: ${errMsg(err)}\n`); }
    process.exit(1);
  }

  let files: PRFile[];
  let pr: PRSummary | undefined;

  if (interactive) {
    const spinner = p.spinner();
    spinner.start(`Loading PR #${chalk.cyan(id)} files…`);
    try {
      [files, pr] = await Promise.all([
        prSvc.getChangedFiles(id),
        prSvc.listPRs().then(list => list.find(p => p.id === id)),
      ]);
      spinner.stop(`${files.length} file${files.length !== 1 ? 's' : ''} changed.`);
    } catch (err: unknown) {
      spinner.stop(chalk.red('Failed to load files.'));
      throw new Error(errMsg(err));
    }
  } else {
    try {
      [files, pr] = await Promise.all([
        prSvc.getChangedFiles(id),
        prSvc.listPRs().then(list => list.find(p => p.id === id)),
      ]);
    } catch (err: unknown) {
      if (options.json) process.stdout.write(JSON.stringify({ error: errMsg(err) }) + '\n');
      else process.stderr.write(`Error: ${errMsg(err)}\n`);
      process.exit(1);
    }
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(files, null, 2) + '\n');
    return;
  }

  if (files.length === 0) {
    if (interactive) p.outro(chalk.dim('No file changes found on this PR.'));
    else process.stdout.write('No file changes found on this PR.\n');
    return;
  }

  if (!interactive) {
    for (const f of files) {
      process.stdout.write(`${f.changeType}\t${f.path}${f.originalPath ? `\t${f.originalPath}` : ''}\n`);
    }
    return;
  }

  printFileList(files);

  // Interactive loop — user picks a file, views diff, optionally comments.
  while (true) {
    const choices = [
      ...files.map(f => ({
        value: f.path,
        label: `${changeTypeBadge(f.changeType)}  ${f.path}`,
        hint:  f.originalPath ? `← ${f.originalPath}` : undefined,
      })),
      { value: '__done__', label: chalk.dim('Done — exit review') },
    ];

    const selected = await p.select({
      message: 'Select a file to review:',
      options: choices,
    });

    if (p.isCancel(selected) || selected === '__done__') break;

    const file = files.find(f => f.path === selected)!;
    showDiff(file, pr);

    // Offer to comment on this file.
    const wantComment = await p.confirm({
      message: `Add a comment on ${chalk.cyan(file.path)}?`,
      initialValue: false,
    });

    if (p.isCancel(wantComment)) break;

    if (wantComment) {
      await postComment(prSvc, id, file);
    }
  }

  p.outro(chalk.dim('Review session ended.'));
}

// ── helpers ───────────────────────────────────────────────────────────────────

function printFileList(files: PRFile[]): void {
  const added    = files.filter(f => f.changeType === 'add').length;
  const edited   = files.filter(f => f.changeType === 'edit').length;
  const deleted  = files.filter(f => f.changeType === 'delete').length;
  const renamed  = files.filter(f => f.changeType === 'rename').length;

  const parts: string[] = [];
  if (added)   parts.push(chalk.green(`+${added} added`));
  if (edited)  parts.push(chalk.yellow(`~${edited} edited`));
  if (deleted) parts.push(chalk.red(`-${deleted} deleted`));
  if (renamed) parts.push(chalk.blue(`→${renamed} renamed`));

  console.log(`\n  ${parts.join(chalk.dim('  ·  '))}\n`);
}

function changeTypeBadge(type: PRFile['changeType']): string {
  switch (type) {
    case 'add':    return chalk.green('+');
    case 'edit':   return chalk.yellow('~');
    case 'delete': return chalk.red('-');
    case 'rename': return chalk.blue('→');
    default:       return chalk.dim('?');
  }
}

function showDiff(file: PRFile, pr?: PRSummary): void {
  if (file.changeType === 'delete') {
    console.log(`\n  ${chalk.red('File was deleted.')} No diff to show.\n`);
    return;
  }

  // Build git diff args — use PR branch info when available.
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

  const lines = diff.split('\n');
  for (const line of lines) {
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

async function postComment(prSvc: IPRService, prId: number, file: PRFile): Promise<void> {
  const text = await p.text({
    message: 'Comment text:',
    placeholder: 'Leave your feedback…',
    validate: v => (!v.trim() ? 'Comment cannot be empty.' : undefined),
  });

  if (p.isCancel(text)) return;

  const lineInput = await p.text({
    message: 'Line number (optional — leave blank for a file-level comment):',
    placeholder: 'e.g. 42',
    validate: v => {
      if (!v.trim()) return undefined;
      if (!/^\d+$/.test(v.trim())) return 'Enter a positive integer or leave blank.';
    },
  });

  if (p.isCancel(lineInput)) return;

  const line = lineInput.trim() ? parseInt(lineInput.trim(), 10) : undefined;

  const spinner = p.spinner();
  spinner.start('Posting comment…');
  try {
    await prSvc.addComment(prId, text, {
      filePath:  file.path,
      startLine: line,
    });
    spinner.stop(chalk.green('✓') + ' Comment posted.');
  } catch (err: unknown) {
    spinner.stop(chalk.red('Failed to post comment.'));
    console.error(chalk.red(errMsg(err)));
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
