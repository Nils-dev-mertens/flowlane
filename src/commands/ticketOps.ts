import chalk from 'chalk';
import { errMsg } from '../utils/errors';
import { container } from '../container';
import { TOKENS } from '../tokens';
import type { ITicketService } from '../services/interfaces/ITicketService';

export interface TicketOpsOptions {
  json?: boolean;
}

type TicketAction = 'close' | 'reopen' | 'label' | 'assign';

async function mutate(
  action: TicketAction,
  ticketId: string,
  options: TicketOpsOptions,
  operation: (svc: ITicketService) => Promise<void>,
  doneMessage: (id: string) => string,
): Promise<void> {
  const ticketSvc = container.resolve<ITicketService>(TOKENS.TicketService);

  try {
    await operation(ticketSvc);

    if (options.json) {
      process.stdout.write(JSON.stringify({ ticketId, action, success: true }, null, 2) + '\n');
      return;
    }
    console.log(chalk.green('✓') + ` ${doneMessage(ticketId)}`);
  } catch (err: unknown) {
    if (options.json) {
      process.stdout.write(JSON.stringify({ ticketId, action, error: errMsg(err) }) + '\n');
    } else {
      console.error(chalk.red(`Failed to ${action} ticket: ${errMsg(err)}`));
    }
    process.exit(1);
  }
}

export async function ticketCloseCommand(
  ticketId: string,
  options: TicketOpsOptions = {},
): Promise<void> {
  return mutate(
    'close',
    ticketId,
    options,
    (svc) => svc.closeTicket(ticketId),
    (id) => `Ticket ${chalk.cyan(`#${id}`)} closed.`,
  );
}

export async function ticketReopenCommand(
  ticketId: string,
  options: TicketOpsOptions = {},
): Promise<void> {
  return mutate(
    'reopen',
    ticketId,
    options,
    (svc) => svc.reopenTicket(ticketId),
    (id) => `Ticket ${chalk.cyan(`#${id}`)} reopened.`,
  );
}

export async function ticketLabelCommand(
  ticketId: string,
  labels: string[],
  options: TicketOpsOptions = {},
): Promise<void> {
  return mutate(
    'label',
    ticketId,
    options,
    (svc) => svc.addLabels(ticketId, labels),
    (id) => `Added labels to ${chalk.cyan(`#${id}`)}: ${labels.join(', ')}`,
  );
}

export async function ticketAssignCommand(
  ticketId: string,
  assignee: string,
  options: TicketOpsOptions = {},
): Promise<void> {
  return mutate(
    'assign',
    ticketId,
    options,
    (svc) => svc.assignTicket(ticketId, assignee),
    (id) => `Ticket ${chalk.cyan(`#${id}`)} assigned to ${chalk.yellow(assignee)}.`,
  );
}