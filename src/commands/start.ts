import * as p from '@clack/prompts';
import chalk from 'chalk';
import { container } from '../container';
import { TOKENS }    from '../tokens';
import { offerColumnFix } from '../utils/boardStatusFix';
import type { IConfigService } from '../services/interfaces/IConfigService';
import type { ITicketService } from '../services/interfaces/ITicketService';
import { branchCommand } from './branch';
import { prCommand }     from './pr';
import { reviewCommand } from './review';

export interface StartOptions {
  /** Called from an interactive TUI session (skip self-contained intro). */
  interactive?: boolean;
}

/**
 * Full workflow: create branch → push → open PR → set ticket to Ready for Review.
 */
export async function startCommand(
  ticketId: string,
  options: StartOptions = {},
): Promise<void> {
  const { interactive = false } = options;

  if (!interactive) {
    p.intro(chalk.bgCyan.black('  flowlane start  ') + chalk.dim(`  Ticket ${ticketId}`));
  }

  p.log.step(`Starting full workflow for ${chalk.cyan(ticketId)}…`);

  // ── Step 0: move ticket to "active / doing" column ───────────────────────

  const cfg        = container.resolve<IConfigService>(TOKENS.ConfigService);
  const ticketSvc  = container.resolve<ITicketService>(TOKENS.TicketService);
  let activeState  = cfg.get<string>('activeStatus') ?? '';
  let activeColumn = cfg.get<string>('activeColumn');

  if (activeState || activeColumn) {
    let label = activeColumn ?? activeState;
    let done  = false;

    while (!done) {
      try {
        await ticketSvc.updateStatus(ticketId, activeState, activeColumn);
        p.log.success(`Ticket moved to "${chalk.yellow(label)}".`);
        done = true;
      } catch (err: unknown) {
        p.log.warn(`Could not move ticket to "${label}": ${errMsg(err)}`);
        const fix = await offerColumnFix(cfg, {
          message:   'Which column means you\'re actively working on a ticket?',
          stateKey:  'activeStatus',
          columnKey: 'activeColumn',
        });
        if (!fix) { done = true; break; }  // skip and continue workflow
        await cfg.set('activeStatus', fix.state);
        await cfg.set('activeColumn', fix.column);
        activeState  = fix.state;
        activeColumn = fix.column;
        label        = fix.column;
      }
    }
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

  // ── Step 2: PR ────────────────────────────────────────────────────────────

  let pr;
  try {
    pr = await prCommand(ticketId, { interactive, sourceBranch: branchName });
  } catch (err: unknown) {
    const msg = errMsg(err);
    if (msg === 'Cancelled') {
      p.outro(`Workflow cancelled. Branch ${chalk.green(branchName)} was created.`);
      return;
    }
    p.outro(chalk.red(`PR step failed: ${msg}`));
    process.exit(1);
  }

  // ── Step 3: set to review (non-fatal) ─────────────────────────────────────

  try {
    await reviewCommand(ticketId, { interactive });
  } catch (err: unknown) {
    const msg = errMsg(err);
    if (msg !== 'Cancelled') {
      p.log.warn(`Could not update ticket status: ${msg}`);
    }
  }

  // ── Done ──────────────────────────────────────────────────────────────────

  p.outro(
    `${chalk.green('✓ Workflow complete!')}\n` +
    `  Branch: ${chalk.green(branchName)}\n` +
    `  PR:     ${chalk.blue.underline(pr.url)}`,
  );
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
