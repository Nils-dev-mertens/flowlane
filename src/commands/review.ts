import * as p from '@clack/prompts';
import chalk from 'chalk';
import { container } from '../container';
import { TOKENS } from '../tokens';
import { offerColumnFix } from '../utils/boardStatusFix';
import type { IConfigService } from '../services/interfaces/IConfigService';
import type { ITicketService } from '../services/interfaces/ITicketService';

export interface ReviewOptions {
  /** Called from an interactive TUI session. */
  interactive?: boolean;
  /** Target status to set — defaults to "Ready for Review". */
  status?: string;
}

/**
 * Transition a ticket to the "Ready for Review" state (or a custom status).
 */
export async function reviewCommand(
  ticketId: string,
  options: ReviewOptions = {},
): Promise<void> {
  const { interactive = false } = options;

  const cfg = container.resolve<IConfigService>(TOKENS.ConfigService);
  assertConfig(cfg);

  // state  = System.State  (e.g. "Active")
  // column = System.BoardColumn (e.g. "Ready for Review") — sub-column under a state
  const state  = options.status ?? cfg.get<string>('reviewStatus') ?? '';
  const column = options.status ? undefined : cfg.get<string>('reviewColumn');

  // What the user sees on the board
  const displayLabel = column ?? state;

  if (!interactive) {
    p.intro(chalk.bgCyan.black('  flowlane review  ') + chalk.dim(`  Ticket ${ticketId}`));
  }

  const ticketSvc = container.resolve<ITicketService>(TOKENS.TicketService);

  if (interactive) {
    const confirmed = await p.confirm({
      message: `Set ticket ${chalk.cyan(ticketId)} → ${chalk.yellow(`"${displayLabel}"`)}?`,
      initialValue: true,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      throw new Error('Cancelled');
    }
  } else {
    p.log.step(`Setting ticket ${chalk.cyan(ticketId)} to "${displayLabel}"…`);
  }

  const spinner = p.spinner();
  spinner.start(`Updating ticket ${chalk.cyan(ticketId)}…`);

  let finalLabel = displayLabel;
  try {
    await ticketSvc.updateStatus(ticketId, state, column);
    spinner.stop(`Ticket ${chalk.cyan(ticketId)} → ${chalk.yellow(displayLabel)}`);
  } catch (err: unknown) {
    const msg = errMsg(err);
    spinner.stop(chalk.red(`Failed: ${msg}`));

    // Offer an interactive fix — pick the correct column and retry.
    const fix = await offerColumnFix(cfg, {
      message:   'Which column should "in review" map to?',
      stateKey:  'reviewStatus',
      columnKey: 'reviewColumn',
    });

    if (!fix) {
      throw new Error(msg);
    }

    await cfg.set('reviewStatus', fix.state);
    await cfg.set('reviewColumn', fix.column);
    finalLabel = fix.column;

    const retrySpinner = p.spinner();
    retrySpinner.start(`Retrying with "${chalk.yellow(fix.column)}"…`);
    try {
      await ticketSvc.updateStatus(ticketId, fix.state, fix.column);
      retrySpinner.stop(`Ticket ${chalk.cyan(ticketId)} → ${chalk.yellow(fix.column)}`);
    } catch (retryErr: unknown) {
      retrySpinner.stop(chalk.red('Still failed.'));
      throw new Error(errMsg(retryErr));
    }
  }

  if (!interactive) {
    p.outro(`${chalk.green('✓')} Status set to "${chalk.yellow(finalLabel)}".`);
  } else {
    p.log.success(`Status updated to "${chalk.yellow(finalLabel)}".`);
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
