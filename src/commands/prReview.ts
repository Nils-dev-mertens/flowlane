import * as p from '@clack/prompts';
import chalk from 'chalk';
import { errMsg } from '../utils/errors';
import { execSync } from 'child_process';
import { container } from '../container';
import { TOKENS } from '../tokens';
import { isInteractive, safeSpinner } from '../utils/tty';
import type { IPRService } from '../services/interfaces/IPRService';
import type { IConfigService } from '../services/interfaces/IConfigService';
import type {
  MergeStrategy,
  PRFile,
  PRSummary,
  PRThread,
  PRVote,
} from '../types';
import { resolvePRId } from '../utils/prResolve';
import { printThread, changeTypeBadge, showDiff, formatReviewers } from '../utils/prDisplay';

export interface PrReviewOptions {
  /** Output the PR summary, threads, and files as JSON and exit (no session). */
  json?: boolean;
}

const VOTE_OPTIONS: Array<{ value: PRVote; label: string; hint: string }> = [
  { value: 'approve',                  label: '✓  Approve',                  hint: 'You\'re happy to merge' },
  { value: 'approve-with-suggestions', label: '~  Approve with suggestions',  hint: 'Approve but left comments' },
  { value: 'wait',                     label: '⏸  Wait for author',           hint: 'Author needs to address feedback' },
  { value: 'reject',                   label: '✗  Request changes',           hint: 'Not ready to merge' },
  { value: 'reset',                    label: '○  Reset vote',                hint: 'Remove your current vote' },
];

const STRATEGY_OPTIONS: Array<{ value: MergeStrategy; label: string; hint: string }> = [
  { value: 'squash',       label: 'Squash commit',        hint: 'Combine all commits into one' },
  { value: 'merge',        label: 'Merge commit',         hint: 'Preserve full commit history' },
  { value: 'rebase',       label: 'Rebase',               hint: 'Replay commits on top of target' },
  { value: 'rebase-merge', label: 'Rebase + merge commit', hint: 'Rebase then add a merge commit' },
];

type MenuAction = 'overview' | 'threads' | 'files' | 'comment' | 'vote' | 'publish'
  | 'complete' | 'abandon' | 'open' | 'exit';

/**
 * Repeatable PR review session.
 *
 * Resolves a PR from an explicit ID, the current branch, or a picker, shows a
 * compact summary, then offers a menu that stays open across actions. Each
 * mutation refreshes the affected data so the next menu reflects reality.
 *
 * Non-interactive / --json mode prints a summary bundle and exits instead.
 */
export async function prReviewCommand(prId?: string, options: PrReviewOptions = {}): Promise<void> {
  const interactive = isInteractive() && !options.json;
  const prSvc = container.resolve<IPRService>(TOKENS.PRService);

  const id = await resolveForSession(prSvc, prId, interactive);
  if (id == null) return; // cancelled in the picker

  const summary = await loadSummary(prSvc, id, interactive);

  if (options.json) {
    const [threads, threadsError] = await settle(prSvc.getThreads(id));
    const [files, filesError]     = await settle(prSvc.getChangedFiles(id));
    process.stdout.write(JSON.stringify({
      pr: summary,
      threads,
      files,
      ...(threadsError || filesError ? { errors: { threads: threadsError, files: filesError } } : {}),
    }, null, 2) + '\n');
    return;
  }

  if (!interactive) {
    printSummary(summary);
    return;
  }

  p.intro(chalk.bgCyan.black('  flowlane pr review  '));
  printSummary(summary);

  // ── session loop ────────────────────────────────────────────────────────────
  for (;;) {
    const action = await p.select<{ value: MenuAction; label: string; hint?: string }[], MenuAction>({
      message: `What would you like to do on PR #${chalk.cyan(id)}?`,
      options: [
        { value: 'overview',  label: 'Show summary',        hint: 'title, branches, reviewers, URL' },
        { value: 'threads',   label: 'Review threads',      hint: 'reply and resolve comments' },
        { value: 'files',     label: 'Review files',        hint: 'view diffs and post inline comments' },
        { value: 'comment',   label: 'Add comment',         hint: 'general or inline comment' },
        { value: 'vote',      label: 'Submit review',       hint: 'approve / request changes / wait' },
        { value: 'publish',   label: 'Publish draft',       hint: 'mark ready for review' },
        { value: 'complete',  label: 'Complete (merge)',    hint: 'choose a merge strategy' },
        { value: 'abandon',   label: 'Abandon (close)',     hint: 'close without merging' },
        { value: 'open',      label: 'Open in browser',     hint: 'view on the provider' },
        { value: 'exit',      label: chalk.dim('Exit review session') },
      ],
    });

    if (p.isCancel(action) || action === 'exit') break;

    switch (action) {
      case 'overview':
        printSummary(summary);
        break;
      case 'threads':
        await reviewThreads(prSvc, id);
        break;
      case 'files':
        await reviewFiles(prSvc, id, summary);
        break;
      case 'comment':
        await postComment(prSvc, id);
        break;
      case 'vote':
        await submitVote(prSvc, id);
        break;
      case 'publish':
        await publishDraft(prSvc, id);
        break;
      case 'complete':
        await completePR(prSvc, id);
        break;
      case 'abandon':
        await abandonPR(prSvc, id);
        break;
      case 'open':
        await openInBrowser(prSvc, id);
        break;
    }
  }

  p.outro(chalk.dim('Review session ended.'));
}

// ── resolution & summary ──────────────────────────────────────────────────────

/**
 * Resolve a PR ID: explicit ID → current branch → interactive picker.
 * Returns null only when the user cancels the picker.
 */
async function resolveForSession(
  prSvc: IPRService,
  prId: string | undefined,
  interactive: boolean,
): Promise<number | null> {
  if (prId != null) return Number(prId);

  try {
    return await resolvePRId(prSvc);
  } catch {
    // No PR on the current branch (or not in a git repo) — fall back to a picker.
  }

  if (!interactive) {
    process.stderr.write('No PR ID provided and none found for the current branch.\n');
    process.exit(1);
  }

  const spinner = safeSpinner();
  spinner.start('Fetching open pull requests…');
  let prs: PRSummary[];
  try {
    prs = await prSvc.listPRs();
    spinner.stop(`${prs.length} open PR${prs.length !== 1 ? 's' : ''} found.`);
  } catch (err: unknown) {
    spinner.stop(chalk.red('Failed to fetch pull requests.'));
    p.outro(chalk.red(errMsg(err)));
    process.exit(1);
  }

  if (prs.length === 0) {
    p.outro(chalk.dim('No open pull requests found.'));
    return null;
  }

  const selected = await p.select({
    message: 'Select a pull request to review:',
    options: prs.map((pr) => ({
      value: String(pr.id),
      label: `#${pr.id}  ${pr.title}`,
      hint: `${pr.sourceBranch} → ${pr.targetBranch}${pr.isDraft ? ' · draft' : ''}`,
    })),
  });

  if (p.isCancel(selected)) return null;
  return Number(selected);
}

async function loadSummary(
  prSvc: IPRService,
  id: number,
  interactive: boolean,
): Promise<PRSummary | undefined> {
  try {
    const list = await prSvc.listPRs();
    return list.find((pr) => pr.id === id);
  } catch {
    return undefined;
  }
}

function printSummary(summary: PRSummary | undefined): void {
  if (!summary) {
    console.log(chalk.dim('  (summary unavailable)'));
    return;
  }
  const draft = summary.isDraft ? chalk.dim(' [DRAFT]') : '';
  const lines = [
    `${chalk.dim('ID:')}       #${summary.id}${draft}`,
    `${chalk.dim('Title:')}    ${summary.title}`,
    `${chalk.dim('Author:')}   ${summary.author}`,
    `${chalk.dim('Branch:')}   ${summary.sourceBranch} → ${summary.targetBranch}`,
    `${chalk.dim('Created:')}  ${summary.createdAt.toISOString().slice(0, 10)}`,
    `${chalk.dim('Reviewers:')} ${formatReviewers(summary.reviewers) || chalk.dim('none')}`,
    `${chalk.dim('URL:')}      ${chalk.blue.underline(summary.url)}`,
  ];
  p.note(lines.join('\n'), `PR #${summary.id}`);
}

// ── actions ───────────────────────────────────────────────────────────────────

async function reviewThreads(prSvc: IPRService, prId: number): Promise<void> {
  const spinner = safeSpinner();
  spinner.start('Loading threads…');
  let threads: PRThread[];
  try {
    threads = await prSvc.getThreads(prId, true);
    spinner.stop(`${threads.length} active thread${threads.length !== 1 ? 's' : ''}.`);
  } catch (err: unknown) {
    spinner.stop(chalk.red('Failed to load threads.'));
    console.error(chalk.red(errMsg(err)));
    return;
  }

  if (threads.length === 0) {
    console.log(chalk.dim('  No active comment threads.'));
    return;
  }

  threads.forEach((thread, i) => printThread(thread, i + 1));

  const selected = await p.select({
    message: 'Act on a thread:',
    options: [
      { value: '__back__', label: chalk.dim('Back') },
      ...threads.map((t, i) => ({
        value: String(t.id),
        label: `Thread #${i + 1}  ${t.filePath ? chalk.dim(`${t.filePath}${t.startLine ? `:${t.startLine}` : ''}`) : chalk.dim('General')}  — ${t.comments[0]?.content.slice(0, 60) ?? ''}`,
      })),
    ],
  });

  if (p.isCancel(selected) || selected === '__back__') return;

  const threadId = Number(selected);
  const action = await p.select({
    message: 'Thread action:',
    options: [
      { value: 'reply',   label: 'Reply' },
      { value: 'resolve', label: 'Resolve thread' },
      { value: 'back',    label: chalk.dim('Back') },
    ],
  });

  if (p.isCancel(action) || action === 'back') return;

  if (action === 'resolve') {
    const s = safeSpinner();
    s.start('Resolving thread…');
    try {
      await prSvc.resolveThread(prId, threadId);
      s.stop(chalk.green('Thread resolved.'));
    } catch (err: unknown) {
      s.stop(chalk.red('Failed to resolve thread.'));
      console.error(chalk.red(errMsg(err)));
    }
    return;
  }

  const text = await p.text({ message: 'Your reply:', placeholder: 'Type your reply…' });
  if (p.isCancel(text) || !text) return;

  const s = safeSpinner();
  s.start('Posting reply…');
  try {
    await prSvc.replyToThread(prId, threadId, text);
    s.stop(chalk.green('Reply posted.'));
  } catch (err: unknown) {
    s.stop(chalk.red('Failed to post reply.'));
    console.error(chalk.red(errMsg(err)));
  }
}

async function reviewFiles(prSvc: IPRService, prId: number, summary?: PRSummary): Promise<void> {
  const spinner = safeSpinner();
  spinner.start('Loading changed files…');
  let files: PRFile[];
  try {
    files = await prSvc.getChangedFiles(prId);
    spinner.stop(`${files.length} file${files.length !== 1 ? 's' : ''} changed.`);
  } catch (err: unknown) {
    spinner.stop(chalk.red('Failed to load files.'));
    console.error(chalk.red(errMsg(err)));
    return;
  }

  if (files.length === 0) {
    console.log(chalk.dim('  No file changes found.'));
    return;
  }

  for (;;) {
    const selected = await p.select({
      message: 'Select a file to review:',
      options: [
        ...files.map((f) => ({
          value: f.path,
          label: `${changeTypeBadge(f.changeType)}  ${f.path}`,
          hint: f.originalPath ? `← ${f.originalPath}` : undefined,
        })),
        { value: '__back__', label: chalk.dim('Back') },
      ],
    });

    if (p.isCancel(selected) || selected === '__back__') return;

    const file = files.find((f) => f.path === selected)!;
    showDiff(file, summary);

    const wantComment = await p.confirm({
      message: `Add a comment on ${chalk.cyan(file.path)}?`,
      initialValue: false,
    });
    if (p.isCancel(wantComment)) return;
    if (wantComment) await postComment(prSvc, prId, file);
  }
}

async function postComment(prSvc: IPRService, prId: number, file?: PRFile): Promise<void> {
  const text = await p.text({
    message: 'Comment text:',
    placeholder: 'Leave your feedback…',
    validate: (v) => (!v.trim() ? 'Comment cannot be empty.' : undefined),
  });
  if (p.isCancel(text) || !text) return;

  let filePath = file?.path;
  let startLine: number | undefined;
  let endLine: number | undefined;

  if (!file) {
    const fileInput = await p.text({
      message: 'File path for inline comment (leave empty for general):',
      placeholder: 'src/foo.ts',
    });
    if (p.isCancel(fileInput)) return;
    if (typeof fileInput === 'string' && fileInput.trim()) {
      filePath = fileInput.trim();

      const lineInput = await p.text({
        message: 'Line number (optional):',
        placeholder: '42',
        validate: (v) => (!v || /^\d+$/.test(v.trim()) ? undefined : 'Must be a number'),
      });
      if (p.isCancel(lineInput)) return;
      if (typeof lineInput === 'string' && lineInput.trim()) {
        startLine = parseInt(lineInput.trim(), 10);

        const endInput = await p.text({
          message: 'End line (optional, multi-line):',
          placeholder: String(startLine),
          validate: (v) => (!v || /^\d+$/.test(v.trim()) ? undefined : 'Must be a number'),
        });
        if (p.isCancel(endInput)) return;
        if (typeof endInput === 'string' && endInput.trim()) {
          endLine = parseInt(endInput.trim(), 10);
        }
      }
    }
  } else if (file.changeType !== 'delete') {
    const lineInput = await p.text({
      message: 'Line number (optional — blank for file-level):',
      placeholder: '42',
      validate: (v) => (!v || /^\d+$/.test(v.trim()) ? undefined : 'Must be a number'),
    });
    if (p.isCancel(lineInput)) return;
    if (typeof lineInput === 'string' && lineInput.trim()) {
      startLine = parseInt(lineInput.trim(), 10);
    }
  }

  const spinner = safeSpinner();
  spinner.start('Posting comment…');
  try {
    await prSvc.addComment(prId, text, { filePath, startLine, endLine });
    spinner.stop(`${chalk.green('✓')} Comment posted.`);
  } catch (err: unknown) {
    spinner.stop(chalk.red('Failed to post comment.'));
    console.error(chalk.red(errMsg(err)));
  }
}

async function submitVote(prSvc: IPRService, prId: number): Promise<void> {
  const choice = await p.select({
    message: `Your review of PR #${chalk.cyan(prId)}:`,
    options: VOTE_OPTIONS,
  });
  if (p.isCancel(choice)) return;

  const vote = choice as PRVote;
  const spinner = safeSpinner();
  spinner.start('Submitting review…');
  try {
    await prSvc.votePR(prId, vote);
    const label = VOTE_OPTIONS.find((o) => o.value === vote)!.label.trim();
    spinner.stop(`${chalk.green('✓')} Submitted: ${chalk.bold(label)}`);
  } catch (err: unknown) {
    spinner.stop(chalk.red('Failed to submit review.'));
    console.error(chalk.red(errMsg(err)));
  }
}

async function publishDraft(prSvc: IPRService, prId: number): Promise<void> {
  const confirmed = await p.confirm({
    message: `Publish PR #${prId} as ready for review?`,
    initialValue: true,
  });
  if (p.isCancel(confirmed) || !confirmed) return;

  const spinner = safeSpinner();
  spinner.start('Publishing…');
  try {
    await prSvc.publishPR(prId);
    spinner.stop(`${chalk.green('✓')} PR published.`);
  } catch (err: unknown) {
    spinner.stop(chalk.red('Failed to publish PR.'));
    console.error(chalk.red(errMsg(err)));
  }
}

async function completePR(prSvc: IPRService, prId: number): Promise<void> {
  const picked = await p.select({
    message: 'Merge strategy:',
    options: STRATEGY_OPTIONS,
  });
  if (p.isCancel(picked)) return;

  const strategy = picked as MergeStrategy;
  const confirmed = await p.confirm({
    message: chalk.yellow(`Complete PR #${prId} using ${strategy}?`),
    initialValue: false,
  });
  if (p.isCancel(confirmed) || !confirmed) return;

  const spinner = safeSpinner();
  spinner.start('Completing pull request…');
  try {
    await prSvc.completePR(prId, strategy);
    spinner.stop(`${chalk.green('✓')} PR #${prId} completed.`);
  } catch (err: unknown) {
    spinner.stop(chalk.red('Failed to complete PR.'));
    console.error(chalk.red(errMsg(err)));
  }
}

async function abandonPR(prSvc: IPRService, prId: number): Promise<void> {
  const confirmed = await p.confirm({
    message: chalk.yellow(`Abandon PR #${prId}? This cannot be undone.`),
    initialValue: false,
  });
  if (p.isCancel(confirmed) || !confirmed) return;

  const spinner = safeSpinner();
  spinner.start('Abandoning pull request…');
  try {
    await prSvc.abandonPR(prId);
    spinner.stop(`${chalk.green('✓')} PR #${prId} abandoned.`);
  } catch (err: unknown) {
    spinner.stop(chalk.red('Failed to abandon PR.'));
    console.error(chalk.red(errMsg(err)));
  }
}

async function openInBrowser(prSvc: IPRService, prId: number): Promise<void> {
  let url: string;
  try {
    url = (await prSvc.getPR(prId)).url;
  } catch (err: unknown) {
    console.error(chalk.red(`Failed to fetch PR URL: ${errMsg(err)}`));
    return;
  }

  const cmd =
    process.platform === 'darwin' ? `open "${url}"` :
    process.platform === 'win32'  ? `start "" "${url}"` :
                                    `xdg-open "${url}"`;
  try {
    execSync(cmd, { stdio: 'ignore' });
    console.log(`${chalk.green('✓')} Opened ${chalk.blue.underline(url)}`);
  } catch {
    console.log(chalk.blue.underline(url));
  }
}

// ── helpers ───────────────────────────────────────────────────────────────



/** Resolve a promise into `[value, errorMessage]` so JSON mode can report failures. */
async function settle<T>(promise: Promise<T>): Promise<[T | undefined, string | undefined]> {
  try {
    return [await promise, undefined];
  } catch (err: unknown) {
    return [undefined, errMsg(err)];
  }
}
