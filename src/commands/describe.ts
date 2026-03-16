import * as p from '@clack/prompts';
import chalk from 'chalk';
import { container } from '../container';
import { TOKENS }    from '../tokens';
import type { ITicketService } from '../services/interfaces/ITicketService';

export async function describeCommand(ticketId: string): Promise<void> {
  p.intro(chalk.bgCyan.black('  flowlane describe  ') + chalk.dim(`  Ticket ${ticketId}`));

  const ticketSvc = container.resolve<ITicketService>(TOKENS.TicketService);

  const spinner = p.spinner();
  spinner.start(`Fetching ticket ${chalk.cyan(ticketId)}…`);

  let ticket;
  try {
    ticket = await ticketSvc.getTicket(ticketId);
    spinner.stop(`Ticket ${chalk.cyan(ticketId)} loaded.`);
  } catch (err: unknown) {
    spinner.stop(chalk.red('Failed to fetch ticket.'));
    p.outro(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  const meta = [
    `${chalk.dim('ID:')}       ${ticket.id}`,
    `${chalk.dim('Title:')}    ${ticket.title}`,
    `${chalk.dim('Type:')}     ${ticket.type ?? 'N/A'}`,
    ticket.boardColumn
      ? `${chalk.dim('Column:')}   ${ticket.boardColumn}${ticket.boardColumn !== ticket.status ? chalk.dim(` (state: ${ticket.status})`) : ''}`
      : `${chalk.dim('Status:')}   ${ticket.status}`,
    ticket.assignee ? `${chalk.dim('Assignee:')} ${ticket.assignee}` : '',
    ticket.url      ? `${chalk.dim('URL:')}      ${chalk.blue.underline(ticket.url)}` : '',
  ].filter(Boolean).join('\n');

  p.note(meta, 'Details');

  if (ticket.description) {
    p.note(ticket.description, 'Description');
  } else {
    p.log.warn('No description set on this ticket.');
  }

  p.outro('Done.');
}
