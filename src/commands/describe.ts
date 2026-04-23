import * as p from '@clack/prompts';
import chalk from 'chalk';
import { container } from '../container';
import { TOKENS }    from '../tokens';
import { isInteractive } from '../utils/tty';
import type { ITicketService } from '../services/interfaces/ITicketService';

export interface DescribeOptions {
  json?: boolean;
}

export async function describeCommand(ticketId: string, options: DescribeOptions = {}): Promise<void> {
  const ticketSvc = container.resolve<ITicketService>(TOKENS.TicketService);
  const interactive = isInteractive() && !options.json;

  if (interactive) {
    p.intro(chalk.bgCyan.black('  flowlane describe  ') + chalk.dim(`  Ticket ${ticketId}`));
  }

  let ticket;

  if (interactive) {
    const spinner = p.spinner();
    spinner.start(`Fetching ticket ${chalk.cyan(ticketId)}…`);
    try {
      ticket = await ticketSvc.getTicket(ticketId);
      spinner.stop(`Ticket ${chalk.cyan(ticketId)} loaded.`);
    } catch (err: unknown) {
      spinner.stop(chalk.red('Failed to fetch ticket.'));
      p.outro(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  } else {
    try {
      ticket = await ticketSvc.getTicket(ticketId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (options.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
      else process.stderr.write(`Error: ${msg}\n`);
      process.exit(1);
    }
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(ticket, null, 2) + '\n');
    return;
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

  if (interactive) {
    p.note(meta, 'Details');
    if (ticket.description) {
      p.note(ticket.description, 'Description');
    } else {
      p.log.warn('No description set on this ticket.');
    }
    p.outro('Done.');
  } else {
    process.stdout.write(meta + '\n');
    if (ticket.description) process.stdout.write('\n' + ticket.description + '\n');
  }
}
