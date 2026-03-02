import * as p from '@clack/prompts';
import chalk from 'chalk';
import { container } from '../container';
import { TOKENS } from '../tokens';
import type { IConfigService } from '../services/interfaces/IConfigService';
import type { ITicketService } from '../services/interfaces/ITicketService';
import type { Ticket } from '../types';

export interface TicketsOptions {
  user?: string;
}

export async function ticketsCommand(options: TicketsOptions = {}): Promise<void> {
  const cfg = container.resolve<IConfigService>(TOKENS.ConfigService);

  p.intro(
    chalk.bgCyan.black('  flowlane  ') +
    chalk.dim(`  ${cfg.get<string>('org')} / ${cfg.get<string>('project')}`),
  );

  // ── Fetch tickets ─────────────────────────────────────────────────────────

  const ticketSvc = container.resolve<ITicketService>(TOKENS.TicketService);
  const user      = (options.user ?? cfg.get<string>('user') ?? '').trim();

  const spinner = p.spinner();
  spinner.start(`Fetching tickets assigned to ${chalk.cyan(user)}…`);

  let tickets: Ticket[];
  try {
    tickets = await ticketSvc.getTicketsForUser(user);
    spinner.stop(`Found ${chalk.green(String(tickets.length))} open ticket(s).`);
  } catch (err: unknown) {
    spinner.stop(chalk.red('Failed to fetch tickets.'));
    p.outro(chalk.red(`Error: ${errMsg(err)}`));
    process.exit(1);
  }

  if (tickets.length === 0) {
    p.outro(chalk.yellow(`No open tickets assigned to "${user}".`));
    return;
  }

  // ── Optional filter ───────────────────────────────────────────────────────

  const filterRaw = await p.text({
    message: 'Filter tickets (press Enter to show all):',
    placeholder: 'Search by ID, title, or status…',
  });

  if (p.isCancel(filterRaw)) { p.outro('Cancelled.'); return; }

  const filter   = (filterRaw ?? '').trim().toLowerCase();
  const filtered = filter
    ? tickets.filter(
        (t) =>
          t.id.toLowerCase().includes(filter) ||
          t.title.toLowerCase().includes(filter) ||
          t.status.toLowerCase().includes(filter),
      )
    : tickets;

  if (filtered.length === 0) {
    p.outro(chalk.yellow(`No tickets match "${filter}".`));
    return;
  }

  // ── Ticket picker ─────────────────────────────────────────────────────────

  const ticketId = await p.select({
    message: `Select a ticket  ${chalk.dim(`(${filtered.length} shown)`)}:`,
    options: filtered.map((t) => ({
      value: t.id,
      label: `${chalk.cyan(t.id.padEnd(10))} ${truncate(t.title, 58)}`,
      hint:  `${t.status}${t.type ? ` · ${t.type}` : ''}`,
    })),
  });

  if (p.isCancel(ticketId)) { p.outro('Cancelled.'); return; }

  const ticket = filtered.find((t) => t.id === ticketId)!;

  p.note(
    [
      `${chalk.dim('ID:')}     ${ticket.id}`,
      `${chalk.dim('Title:')}  ${ticket.title}`,
      `${chalk.dim('Status:')} ${ticket.status}`,
      `${chalk.dim('Type:')}   ${ticket.type ?? 'N/A'}`,
      ticket.url
        ? `${chalk.dim('URL:')}    ${chalk.blue.underline(ticket.url)}`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
    'Ticket',
  );

  // ── Action picker ─────────────────────────────────────────────────────────

  const action = await p.select({
    message: 'What would you like to do?',
    options: [
      {
        value: 'start',
        label: chalk.bold('Full workflow'),
        hint:  'create branch → push → open PR → set to In Review',
      },
      { value: 'branch', label: 'Create & push branch' },
      { value: 'pr',     label: 'Create pull request' },
      { value: 'review', label: 'Set status to In Review' },
    ],
  });

  if (p.isCancel(action)) { p.outro('Cancelled.'); return; }

  // Import commands lazily to avoid circular-dependency issues at top-level.
  const { branchCommand } = await import('./branch');
  const { prCommand }     = await import('./pr');
  const { reviewCommand } = await import('./review');
  const { startCommand }  = await import('./start');

  console.log('');

  switch (action) {
    case 'start':
      await startCommand(ticketId as string, { interactive: true });
      break;
    case 'branch':
      await branchCommand(ticketId as string, { interactive: true });
      break;
    case 'pr':
      await prCommand(ticketId as string, { interactive: true });
      break;
    case 'review':
      await reviewCommand(ticketId as string, { interactive: true });
      break;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
