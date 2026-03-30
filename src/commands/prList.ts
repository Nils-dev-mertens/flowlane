import * as p from '@clack/prompts';
import chalk from 'chalk';
import { container } from '../container';
import { TOKENS }    from '../tokens';
import type { IConfigService } from '../services/interfaces/IConfigService';
import type { IPRService }     from '../services/interfaces/IPRService';
import type { PRSummary }      from '../types';

/**
 * List active pull requests for the configured repository,
 * grouped into "your PRs" and "waiting for your review".
 */
export async function prListCommand(): Promise<void> {
  p.intro(chalk.bgCyan.black('  flowlane pr list  '));

  const cfg    = container.resolve<IConfigService>(TOKENS.ConfigService);
  const prSvc  = container.resolve<IPRService>(TOKENS.PRService);
  const myUser = (cfg.get<string>('user') ?? '').toLowerCase();

  const spinner = p.spinner();
  spinner.start('Fetching pull requests…');

  let all: PRSummary[];
  try {
    all = await prSvc.listPRs();
    spinner.stop(`${all.length} active PR${all.length !== 1 ? 's' : ''} found.`);
  } catch (err: unknown) {
    spinner.stop(chalk.red('Failed to fetch pull requests.'));
    throw new Error(errMsg(err));
  }

  if (all.length === 0) {
    p.outro(chalk.dim('No active pull requests found.'));
    return;
  }

  const mine      = all.filter(pr => pr.authorEmail.toLowerCase() === myUser);
  const toReview  = all.filter(pr =>
    pr.authorEmail.toLowerCase() !== myUser &&
    pr.reviewers.some(r => r.email.toLowerCase() === myUser && r.vote === 0),
  );
  const other     = all.filter(pr =>
    !mine.includes(pr) && !toReview.includes(pr),
  );

  if (mine.length > 0) {
    p.log.step(chalk.bold(`Your PRs  (${mine.length})`));
    mine.forEach(pr => printPR(pr, 'mine'));
  }

  if (toReview.length > 0) {
    p.log.step(chalk.bold(`Waiting for your review  (${toReview.length})`));
    toReview.forEach(pr => printPR(pr, 'review'));
  }

  if (other.length > 0) {
    p.log.step(chalk.bold(`Other active PRs  (${other.length})`));
    other.forEach(pr => printPR(pr, 'other'));
  }

  p.outro(chalk.dim('Use  flowlane pr threads [prId]  to read review comments.'));
}

// ── helpers ──────────────────────────────────────────────────────────────────

function printPR(pr: PRSummary, _context: 'mine' | 'review' | 'other'): void {
  const draft  = pr.isDraft ? chalk.dim(' [DRAFT]') : '';
  const age    = formatAge(pr.createdAt);
  const title  = pr.title.length > 55 ? pr.title.slice(0, 54) + '…' : pr.title;
  const branch = chalk.dim(`${pr.sourceBranch} → ${pr.targetBranch}`);
  const votes  = formatReviewers(pr.reviewers);

  console.log(
    `\n  ${chalk.cyan(`#${String(pr.id).padEnd(6)}`)}${chalk.bold(title)}${draft}  ${chalk.dim(age)}`,
  );
  console.log(`           ${branch}`);
  if (votes) console.log(`           ${votes}`);
}

function formatReviewers(reviewers: PRSummary['reviewers']): string {
  if (reviewers.length === 0) return '';
  return reviewers.map(r => {
    const name = r.name.split(' ')[0]; // first name only
    if (r.vote === 10)  return chalk.green(`✓ ${name}`);
    if (r.vote === 5)   return chalk.yellow(`~ ${name}`);
    if (r.vote === -5)  return chalk.yellow(`⏸ ${name}`);
    if (r.vote === -10) return chalk.red(`✗ ${name}`);
    return chalk.dim(`○ ${name}`);
  }).join(chalk.dim('  ·  '));
}

function formatAge(date: Date): string {
  const diff = Date.now() - date.getTime();
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
