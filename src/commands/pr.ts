import * as p from '@clack/prompts';
import chalk from 'chalk';
import { container } from '../container';
import { TOKENS } from '../tokens';
import type { IConfigService } from '../services/interfaces/IConfigService';
import type { ITicketService } from '../services/interfaces/ITicketService';
import type { IPRService }     from '../services/interfaces/IPRService';
import type { IGitService }    from '../services/interfaces/IGitService';
import type { PullRequest }    from '../types';

export interface PROptions {
  /** Called from an interactive TUI session. */
  interactive?: boolean;
  /** Override the source branch (defaults to current git branch). */
  sourceBranch?: string;
}

/**
 * Create a pull request for a ticket, linking the work item.
 *
 * @returns The created PullRequest.
 */
export async function prCommand(
  ticketId: string,
  options: PROptions = {},
): Promise<PullRequest> {
  const { interactive = false } = options;

  const cfg = container.resolve<IConfigService>(TOKENS.ConfigService);
  assertConfig(cfg);

  if (!interactive) {
    p.intro(chalk.bgCyan.black('  flowlane pr  ') + chalk.dim(`  Ticket ${ticketId}`));
  }

  const ticketSvc  = container.resolve<ITicketService>(TOKENS.TicketService);
  const prSvc      = container.resolve<IPRService>(TOKENS.PRService);
  const gitSvc     = container.resolve<IGitService>(TOKENS.GitService);
  const targetBranch = cfg.get<string>('baseBranch') || 'main';

  // ── Resolve source branch ─────────────────────────────────────────────────

  let sourceBranch = options.sourceBranch ?? '';
  if (!sourceBranch) {
    try {
      sourceBranch = gitSvc.getCurrentBranch();
    } catch {
      sourceBranch = '';
    }
  }

  // ── Fetch ticket ──────────────────────────────────────────────────────────

  const fetchSpinner = p.spinner();
  fetchSpinner.start(`Fetching ticket ${chalk.cyan(ticketId)}…`);

  let ticket;
  try {
    ticket = await ticketSvc.getTicket(ticketId);
    fetchSpinner.stop(`${chalk.cyan(ticket.id)} — ${ticket.title}`);
  } catch (err: unknown) {
    fetchSpinner.stop(chalk.red('Failed to fetch ticket.'));
    throw new Error(`Could not fetch ticket ${ticketId}: ${errMsg(err)}`);
  }

  // ── Confirm in interactive mode ───────────────────────────────────────────

  if (interactive) {
    const confirmed = await p.confirm({
      message:
        `Open PR: ${chalk.green(sourceBranch)} → ${chalk.blue(targetBranch)}?`,
      initialValue: true,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      throw new Error('Cancelled');
    }
  } else {
    p.log.step(`${chalk.green(sourceBranch)} → ${chalk.blue(targetBranch)}`);
  }

  // ── Create PR ─────────────────────────────────────────────────────────────

  const prSpinner = p.spinner();
  prSpinner.start('Creating pull request…');

  let pr: PullRequest;
  try {
    pr = await prSvc.createPR({
      ticketId,
      title:        ticket.title,
      description:  buildDescription(ticket.id, ticket.title, ticket.url),
      sourceBranch: sourceBranch || 'HEAD',
      targetBranch,
    });
    prSpinner.stop(`PR #${pr.id} created.`);
  } catch (err: unknown) {
    prSpinner.stop(chalk.red('Failed to create pull request.'));
    throw new Error(`Could not create PR: ${errMsg(err)}`);
  }

  if (!interactive) {
    p.outro(`${chalk.green('✓')} Pull request: ${chalk.blue.underline(pr.url)}`);
  } else {
    p.log.success(`Pull request: ${chalk.blue.underline(pr.url)}`);
  }

  return pr;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function buildDescription(id: string, title: string, url?: string): string {
  return [
    '## Summary',
    '',
    `Closes work item #${id}: ${title}`,
    url ? `Work item: ${url}` : '',
    '',
    '## Changes',
    '',
    '<!-- Describe your changes here -->',
    '',
    '## Test Plan',
    '',
    '<!-- How was this tested? -->',
  ]
    .filter((l) => l !== undefined)
    .join('\n');
}

function assertConfig(cfg: IConfigService): void {
  const { valid, missing } = cfg.validate();
  if (!valid) {
    console.error(chalk.red(`Missing config: ${missing.join(', ')}. Run: flowlane init`));
    process.exit(1);
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
