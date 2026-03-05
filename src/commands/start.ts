import * as p from '@clack/prompts';
import chalk from 'chalk';
import { container } from '../container';
import { TOKENS }    from '../tokens';
import type { IConfigService } from '../services/interfaces/IConfigService';
import type { ITicketService } from '../services/interfaces/ITicketService';
import { branchCommand } from './branch';

export interface StartOptions {
  /** Called from an interactive TUI session (skip self-contained intro). */
  interactive?: boolean;
}

/**
 * Full workflow: set ticket active → create branch → push.
 * PR creation is left to the user once the work is ready.
 */
export async function startCommand(
  ticketId: string,
  options: StartOptions = {},
): Promise<void> {
  const { interactive = false } = options;

  if (!interactive) {
    p.intro(chalk.bgCyan.black('  flowlane start  ') + chalk.dim(`  Ticket ${ticketId}`));
  }

  p.log.step(`Starting workflow for ${chalk.cyan(ticketId)}…`);

  // ── Step 0: set ticket state to active (no column change) ────────────────

  const cfg       = container.resolve<IConfigService>(TOKENS.ConfigService);
  const ticketSvc = container.resolve<ITicketService>(TOKENS.TicketService);
  const activeState = cfg.get<string>('activeStatus') ?? 'Active';

  try {
    await ticketSvc.updateStatus(ticketId, activeState, undefined);
    p.log.success(`Ticket state set to "${chalk.yellow(activeState)}".`);
  } catch (err: unknown) {
    p.log.warn(`Could not update ticket state: ${errMsg(err)}`);
  }

  // ── Step 1: branch ────────────────────────────────────────────────────────

  let branchName: string;
  try {
    branchName = await branchCommand(ticketId, { interactive });
  } catch (err: unknown) {
    const msg = errMsg(err);
    if (msg === 'Cancelled') { p.outro('Workflow cancelled.'); return; }
    p.outro(chalk.red(`Branch step failed: ${msg}`));
    process.exit(1);
  }

  // ── Done ──────────────────────────────────────────────────────────────────

  p.outro(
    `${chalk.green('✓ Branch ready!')}\n` +
    `  Branch: ${chalk.green(branchName)}\n` +
    `  Run ${chalk.cyan('flowlane pr ' + ticketId)} when you're ready to open a PR.`,
  );
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
