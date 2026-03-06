import * as p from '@clack/prompts';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { container } from '../container';
import { TOKENS } from '../tokens';
import { fetchBoardColumns } from '../utils/azureBoard';
import { ticketIdFromBranch } from '../utils/branch';
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

  // ── Detect current branch ticket ──────────────────────────────────────────

  let branchTicketId: string | undefined;
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
    branchTicketId = ticketIdFromBranch(branch) ?? undefined;
    if (branchTicketId) {
      p.log.info(`Current branch: ticket ${chalk.cyan(branchTicketId)}`);
    }
  } catch { /* not in a git repo */ }

  // ── Ticket picker ─────────────────────────────────────────────────────────

  const ticketId = await p.select({
    message: `Select a ticket  ${chalk.dim(`(${filtered.length} shown)`)}:`,
    initialValue: filtered.some((t) => t.id === branchTicketId) ? branchTicketId : undefined,
    options: filtered.map((t) => ({
      value: t.id,
      label: `${chalk.cyan(t.id.padEnd(10))} ${truncate(t.title, 58)}`,
      hint:  `${t.boardColumn ?? t.status}${t.boardColumn && t.boardColumn !== t.status ? ` (${t.status})` : ''}${t.type ? ` · ${t.type}` : ''}`,
    })),
  });

  if (p.isCancel(ticketId)) { p.outro('Cancelled.'); return; }

  const ticket = filtered.find((t) => t.id === ticketId)!;

  p.note(
    [
      `${chalk.dim('ID:')}     ${ticket.id}`,
      `${chalk.dim('Title:')}  ${ticket.title}`,
      ticket.boardColumn
        ? `${chalk.dim('Column:')} ${ticket.boardColumn}${ticket.boardColumn !== ticket.status ? chalk.dim(` (state: ${ticket.status})`) : ''}`
        : `${chalk.dim('Status:')} ${ticket.status}`,
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

  const activeLabel = cfg.get<string>('activeColumn') ?? cfg.get<string>('activeStatus');
  const startHint   = [
    activeLabel ? `set to ${activeLabel}` : null,
    'create branch',
    'push',
  ].filter(Boolean).join(' → ');

  const action = await p.select({
    message: 'What would you like to do?',
    options: [
      { value: 'column',  label: 'Change column / status',  hint: 'move ticket to any column on the board' },
      { value: 'start',   label: chalk.bold('Full workflow'), hint: startHint },
      { value: 'branch',  label: 'Create & push branch' },
      { value: 'pr',      label: 'Create pull request' },
    ],
  });

  if (p.isCancel(action)) { p.outro('Cancelled.'); return; }

  // Import commands lazily to avoid circular-dependency issues at top-level.
  const { branchCommand } = await import('./branch');
  const { prCommand }     = await import('./pr');
  const { startCommand }  = await import('./start');

  console.log('');

  switch (action) {
    case 'column': {
      const org  = cfg.get<string>('org')!;
      const proj = cfg.get<string>('project')!;
      const tok  = cfg.get<string>('token')!;

      // Resolve team — use stored value or ask once and save it.
      let team = cfg.get<string>('team');
      if (!team) {
        const teamInput = await p.text({
          message:     'Azure DevOps team name (needed to read the board):',
          placeholder: `${proj} Team`,
          validate:    (v) => v.trim() ? undefined : 'Required',
        }) as string;
        if (p.isCancel(teamInput)) { p.outro('Cancelled.'); break; }
        team = teamInput.trim();
        await cfg.set('team', team);
      }

      // Fetch columns.
      const fetchSpinner = p.spinner();
      fetchSpinner.start(`Fetching board columns for "${team}"…`);
      let columns: Awaited<ReturnType<typeof fetchBoardColumns>> = [];
      try {
        columns = await fetchBoardColumns(org, proj, tok, team);
        fetchSpinner.stop(`${columns.length} columns found.`);
      } catch (err: unknown) {
        fetchSpinner.stop(chalk.red(`Could not fetch board: ${errMsg(err)}`));
        p.outro(chalk.red('Cannot change column without board data. Check your team name with `flowlane config set team "<name>"`'));
        break;
      }

      const pick = await p.select({
        message: 'Move ticket to which column?',
        options: columns.map((col) => ({
          value: col.name,
          label: col.name,
          hint:  col.states.length > 0 ? `state: ${col.states.join(', ')}` : '',
        })),
      }) as string;
      if (p.isCancel(pick)) { p.outro('Cancelled.'); break; }

      const col = columns.find((c) => c.name === pick)!;

      const moveSpinner = p.spinner();
      moveSpinner.start(`Moving ticket to "${chalk.yellow(pick)}"…`);
      try {
        await ticketSvc.updateStatus(ticketId as string, col.states[0] ?? '', pick);
        moveSpinner.stop(`Ticket ${chalk.cyan(ticketId as string)} → ${chalk.yellow(pick)}`);
        p.outro(`${chalk.green('✓')} Ticket moved to "${chalk.yellow(pick)}".`);
      } catch (err: unknown) {
        moveSpinner.stop(chalk.red(`Failed: ${errMsg(err)}`));
        p.outro(chalk.red('Could not update ticket status.'));
      }
      break;
    }
    case 'start':
      await startCommand(ticketId as string, { interactive: true });
      break;
    case 'branch':
      await branchCommand(ticketId as string, { interactive: true });
      break;
    case 'pr':
      await prCommand(ticketId as string, { interactive: true });
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
