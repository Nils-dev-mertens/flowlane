import * as p from '@clack/prompts';
import chalk from 'chalk';
import { assertConfig } from '../utils/assertConfig';
import { errMsg } from '../utils/errors';
import { container } from '../container';
import { TOKENS } from '../tokens';
import type { IConfigService } from '../services/interfaces/IConfigService';
import type { ITicketService } from '../services/interfaces/ITicketService';
import type { IGitService }    from '../services/interfaces/IGitService';
import { generateBranchName, titleIsTruncated } from '../utils/branch';
import { runHook }             from '../utils/hooks';
import { safeSpinner }         from '../utils/tty';

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

  const fetchSpinner = safeSpinner();
  fetchSpinner.start(`Fetching ticket ${chalk.cyan(ticketId)}…`);

  let ticket;
  try {
    ticket = await ticketSvc.getTicket(ticketId);
    fetchSpinner.stop(`${chalk.cyan(ticket.id)} — ${ticket.title}`);
  } catch (err: unknown) {
    fetchSpinner.stop(chalk.red('Failed to fetch ticket.'));
    throw new Error(`Could not fetch ticket ${ticketId}: ${errMsg(err)}`);
  }

  const generatedName = generateBranchName(ticket.id, ticket.title);
  const wasTruncated  = titleIsTruncated(ticket.title);

  // ── Confirm / edit branch name ────────────────────────────────────────────

  let branchName = generatedName;

  if (wasTruncated) {
    // Title was longer than the 4-word slug limit. In an interactive terminal
    // let the user confirm or edit; otherwise use the generated name (this also
    // avoids a TTY prompt crashing non-interactive/CI runs).
    p.log.warn(`Title is long; branch name was shortened to: ${chalk.green(generatedName)}`);
    if (interactive) {
      const edited = await p.text({
        message: 'Branch name (edit if needed, Enter to accept):',
        initialValue: generatedName,
        validate: (v) => v.trim() ? undefined : 'Branch name cannot be empty',
      });
      if (p.isCancel(edited)) throw new Error('Cancelled');
      branchName = (edited as string).trim();
    } else {
      p.log.step(`Branch name: ${chalk.green(branchName)}`);
    }
  } else if (interactive) {
    const confirmed = await p.confirm({
      message: `Create branch ${chalk.green(generatedName)}?`,
      initialValue: true,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      throw new Error('Cancelled');
    }
  } else {
    p.log.step(`Branch name: ${chalk.green(branchName)}`);
  }

  // ── Create branch ─────────────────────────────────────────────────────────

  const createSpinner = safeSpinner();
  createSpinner.start('Creating branch…');
  try {
    // The branch is created locally and pushed; it becomes linked to the issue
    // when the PR is opened (GitHub via the "Closes #<id>" reference, Azure DevOps
    // via the PR's workItemRefs) — matching both providers' auto-linking.
    gitSvc.createBranch(branchName);
    gitSvc.publishBranch(branchName);
    createSpinner.stop(`Branch created: ${chalk.green(branchName)}`);
  } catch (err: unknown) {
    createSpinner.stop(chalk.red('Failed to create branch.'));
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
