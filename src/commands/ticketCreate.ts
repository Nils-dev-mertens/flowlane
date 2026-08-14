import chalk from 'chalk';
import { container } from '../container';
import { TOKENS } from '../tokens';
import type { ITicketService } from '../services/interfaces/ITicketService';
import type { TicketKind } from '../types';

const VALID_KINDS: ReadonlyArray<TicketKind> = ['issue', 'task', 'bug', 'story'];

export interface TicketCreateOptions {
  title: string;
  description?: string;
  kind?: string;
  assignee?: string;
  labels?: string;
  parent?: string;
  json?: boolean;
}

export async function ticketCreateCommand(options: TicketCreateOptions): Promise<void> {
  const kind = options.kind?.trim().toLowerCase();
  if (kind && !(VALID_KINDS as ReadonlyArray<string>).includes(kind)) {
    console.error(chalk.red(`Invalid --kind "${options.kind}". Valid values: ${VALID_KINDS.join(', ')}`));
    process.exit(1);
  }

  const labels = options.labels
    ?.split(',')
    .map((label) => label.trim())
    .filter(Boolean);

  const ticketSvc = container.resolve<ITicketService>(TOKENS.TicketService);

  try {
    const ticket = await ticketSvc.createTicket({
      title:       options.title,
      description: options.description?.trim() || undefined,
      kind:        (kind as TicketKind | undefined),
      assignee:    options.assignee?.trim() || undefined,
      labels:      labels && labels.length > 0 ? labels : undefined,
      parentId:    options.parent?.trim() || undefined,
    });

    if (options.json) {
      process.stdout.write(JSON.stringify(ticket, null, 2) + '\n');
      return;
    }

    console.log(chalk.green('✓') + ` Created ${ticket.type ?? 'issue'} ${chalk.cyan(`#${ticket.id}`)}: ${ticket.title}`);
    if (ticket.url) console.log(chalk.dim(ticket.url));
  } catch (err: unknown) {
    if (options.json) {
      process.stdout.write(JSON.stringify({ error: errMsg(err) }) + '\n');
    } else {
      console.error(chalk.red(`Failed to create ticket: ${errMsg(err)}`));
    }
    process.exit(1);
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
