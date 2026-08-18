import * as p from '@clack/prompts';
import chalk from 'chalk';
import { errMsg } from '../utils/errors';
import { container } from '../container';
import { TOKENS }    from '../tokens';
import { isInteractive, safeSpinner } from '../utils/tty';
import type { IConfigService } from '../services/interfaces/IConfigService';
import type { IPRService }     from '../services/interfaces/IPRService';
import type { PRSummary }      from '../types';
import { formatAge, formatReviewers } from '../utils/prDisplay';

export interface PrListOptions {
  /** Output as JSON. */
  json?: boolean;
  /** Only show PRs authored by the configured user. */
  mine?: boolean;
  /** Only show draft PRs. */
  draft?: boolean;
}

/**
 * List active pull requests for the configured repository,
 * grouped into "your PRs" and "waiting for your review".
 */
export async function prListCommand(options: PrListOptions = {}): Promise<void> {
  const cfg    = container.resolve<IConfigService>(TOKENS.ConfigService);
  const prSvc  = container.resolve<IPRService>(TOKENS.PRService);
  const myUser = (cfg.getProviderConfig(cfg.getVcsProvider()).user ?? '').toLowerCase();

  const interactive = isInteractive() && !options.json;

  if (interactive) p.intro(chalk.bgCyan.black('  flowlane pr list  '));

  let all: PRSummary[];
  if (interactive) {
    const spinner = safeSpinner();
    spinner.start('Fetching pull requests…');
    try {
      all = await prSvc.listPRs();
      spinner.stop(`${all.length} active PR${all.length !== 1 ? 's' : ''} found.`);
    } catch (err: unknown) {
      spinner.stop(chalk.red('Failed to fetch pull requests.'));
      throw new Error(errMsg(err));
    }
  } else {
    process.stderr.write('Fetching pull requests…\n');
    try {
      all = await prSvc.listPRs();
    } catch (err: unknown) {
      if (options.json) process.stdout.write(JSON.stringify({ error: errMsg(err) }) + '\n');
      else process.stderr.write(`Error: ${errMsg(err)}\n`);
      process.exit(1);
    }
  }

  // Apply --mine and --draft filters
  let filtered = options.mine
    ? all.filter(pr => pr.authorEmail.toLowerCase() === myUser)
    : all;
  if (options.draft) filtered = filtered.filter(pr => pr.isDraft);

  const mine     = filtered.filter(pr => pr.authorEmail.toLowerCase() === myUser);
  const toReview = filtered.filter(pr =>
    pr.authorEmail.toLowerCase() !== myUser &&
    pr.reviewers.some(r => r.email.toLowerCase() === myUser && r.vote === 0),
  );
  const other    = filtered.filter(pr => !mine.includes(pr) && !toReview.includes(pr));

  if (options.json) {
    process.stdout.write(JSON.stringify({ mine, toReview, other }, null, 2) + '\n');
    return;
  }

  if (filtered.length === 0) {
    if (interactive) p.outro(chalk.dim('No pull requests match the given filters.'));
    else process.stdout.write('No pull requests match the given filters.\n');
    return;
  }

  if (interactive) {
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
  } else {
    for (const pr of filtered) {
      const draft = pr.isDraft ? ' [DRAFT]' : '';
      process.stdout.write(`#${pr.id}\t${pr.authorEmail}\t${pr.sourceBranch} → ${pr.targetBranch}\t${pr.title}${draft}\n`);
    }
  }
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
