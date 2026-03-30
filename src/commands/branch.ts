import * as p from '@clack/prompts';
import chalk from 'chalk';
import { container } from '../container';
import { TOKENS } from '../tokens';
import type { IConfigService } from '../services/interfaces/IConfigService';
import type { ITicketService } from '../services/interfaces/ITicketService';
import type { IGitService }    from '../services/interfaces/IGitService';
import { generateBranchName }  from '../utils/branch';
import { runHook }             from '../utils/hooks';

export interface BranchOptions {
  /** Called from an interactive TUI session (skip self-contained intro/outro). */
  interactive?: boolean;
}

/**
 * Fetch a ticket, propose a branch name, create the branch, and push it.
 *
 * @returns The created branch name.
 */
export async function branchCommand(
  ticketId: string,
  options: BranchOptions = {},
): Promise<string> {
  const { interactive = false } = options;

  const cfg = container.resolve<IConfigService>(TOKENS.ConfigService);
  assertConfig(cfg);

  if (!interactive) {
    p.intro(chalk.bgCyan.black('  flowlane branch  ') + chalk.dim(`  Ticket ${ticketId}`));
  }

  const ticketSvc = container.resolve<ITicketService>(TOKENS.TicketService);
  const gitSvc    = container.resolve<IGitService>(TOKENS.GitService);

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

  const branchName = generateBranchName(ticket.id, ticket.title);

  // ── Confirm branch name (interactive mode) ────────────────────────────────

  if (interactive) {
    const confirmed = await p.confirm({
      message: `Create branch ${chalk.green(branchName)}?`,
      initialValue: true,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      throw new Error('Cancelled');
    }
  } else {
    p.log.step(`Branch name: ${chalk.green(branchName)}`);
  }

  // ── Create branch ─────────────────────────────────────────────────────────

  const createSpinner = p.spinner();
  createSpinner.start('Creating branch…');
  try {
    gitSvc.createBranch(branchName);
    createSpinner.stop(`Branch created: ${chalk.green(branchName)}`);
  } catch (err: unknown) {
    createSpinner.stop(chalk.red('Failed to create branch.'));
    throw new Error(errMsg(err));
  }

  // ── Push branch ───────────────────────────────────────────────────────────

  const pushSpinner = p.spinner();
  pushSpinner.start('Pushing branch to origin…');
  try {
    gitSvc.publishBranch(branchName);
    pushSpinner.stop(`Pushed: ${chalk.green(branchName)}`);
  } catch (err: unknown) {
    pushSpinner.stop(chalk.red('Failed to push branch.'));
    throw new Error(errMsg(err));
  }

  if (!interactive) {
    p.outro(`${chalk.green('✓')} Branch ready: ${chalk.green(branchName)}`);
  } else {
    p.log.success(`Branch ready: ${chalk.green(branchName)}`);
  }

  runHook(cfg.get<string>('hookAfterBranch'), { branch: branchName, ticketId });

  return branchName;
}

// ── helpers ──────────────────────────────────────────────────────────────────

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
