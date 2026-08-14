import * as p from '@clack/prompts';
import chalk from 'chalk';
import { assertConfig } from '../utils/assertConfig';
import { errMsg } from '../utils/errors';
import { container } from '../container';
import { TOKENS } from '../tokens';
import { offerColumnFix } from '../utils/boardStatusFix';
import type { IConfigService } from '../services/interfaces/IConfigService';
import type { ITicketService } from '../services/interfaces/ITicketService';
import { workflowTarget } from '../utils/workflowTarget';
import { runHook }             from '../utils/hooks';

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

  const provider = cfg.getTicketProvider();

  // state  = System.State (ADO) / transition name (Jira)
  // column = System.BoardColumn (Azure DevOps only)
  const target = options.status
    ? { state: options.status, column: undefined }
    : workflowTarget(provider, cfg.getAll(), 'review');

  if (!target) {
    throw new Error(
      `${provider} tickets have no "review" status. ` +
      (provider === 'azuredevops'
        ? 'Run: flowlane config set azuredevops.reviewStatus "<state>"'
        : 'GitHub issues only support open/closed; add a label or use --status to close.'),
    );
  }

  const state  = target.state ?? '';
  const column = target.column;

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

    // The interactive column fix is Azure DevOps-specific (board columns).
    if (provider !== 'azuredevops') {
      throw new Error(msg);
    }

    const fix = await offerColumnFix(cfg, {
      message:   'Which column should "in review" map to?',
      stateKey:  'reviewStatus',
      columnKey: 'reviewColumn',
    });

    if (!fix) {
      throw new Error(msg);
    }

    await cfg.setProviderField('azuredevops', 'reviewStatus', fix.state);
    await cfg.setProviderField('azuredevops', 'reviewColumn', fix.column);
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

  runHook(cfg.get<string>('hookAfterReview'), { ticketId });
}
