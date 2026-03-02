import * as p from '@clack/prompts';
import chalk from 'chalk';
import { container } from '../container';
import { TOKENS } from '../tokens';
import type { IConfigService } from '../services/interfaces/IConfigService';
import type { ITicketService } from '../services/interfaces/ITicketService';

export interface ReviewOptions {
  /** Called from an interactive TUI session. */
  interactive?: boolean;
  /** Target status to set — defaults to "In Review". */
  status?: string;
}

/**
 * Transition a ticket to the "In Review" state (or a custom status).
 */
export async function reviewCommand(
  ticketId: string,
  options: ReviewOptions = {},
): Promise<void> {
  const { interactive = false, status = 'In Review' } = options;

  const cfg = container.resolve<IConfigService>(TOKENS.ConfigService);
  assertConfig(cfg);

  if (!interactive) {
    p.intro(chalk.bgCyan.black('  flowlane review  ') + chalk.dim(`  Ticket ${ticketId}`));
  }

  const ticketSvc = container.resolve<ITicketService>(TOKENS.TicketService);

  if (interactive) {
    const confirmed = await p.confirm({
      message: `Set ticket ${chalk.cyan(ticketId)} → ${chalk.yellow(`"${status}"`)}?`,
      initialValue: true,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      throw new Error('Cancelled');
    }
  } else {
    p.log.step(`Setting ticket ${chalk.cyan(ticketId)} to "${status}"…`);
  }

  const spinner = p.spinner();
  spinner.start(`Updating ticket ${chalk.cyan(ticketId)}…`);

  try {
    await ticketSvc.updateStatus(ticketId, status);
    spinner.stop(`Ticket ${chalk.cyan(ticketId)} → ${chalk.yellow(status)}`);
  } catch (err: unknown) {
    spinner.stop(chalk.red('Failed to update ticket status.'));
    throw new Error(`Could not update ticket ${ticketId}: ${errMsg(err)}`);
  }

  if (!interactive) {
    p.outro(`${chalk.green('✓')} Status set to "${chalk.yellow(status)}".`);
  } else {
    p.log.success(`Status updated to "${chalk.yellow(status)}".`);
  }
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
