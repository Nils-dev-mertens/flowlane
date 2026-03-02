import chalk from 'chalk';
import type { Ticket } from '../types';

export function formatTicketLine(ticket: Ticket): string {
  const id     = chalk.cyan(ticket.id.padEnd(10));
  const type   = ticket.type ? chalk.yellow(`[${ticket.type}] `) : '';
  const title  = ticket.title.slice(0, 60) + (ticket.title.length > 60 ? '…' : '');
  const status = chalk.dim(`(${ticket.status})`);
  return `${id} ${type}${title} ${status}`;
}

export function formatBranch(name: string): string {
  return chalk.green(name);
}

export function formatPRUrl(url: string): string {
  return chalk.blue.underline(url);
}

export function printHeader(subtitle?: string): void {
  const sub = subtitle ? chalk.dim(`  ${subtitle}`) : '';
  console.log(chalk.bgCyan.black('  flowlane  ') + sub);
  console.log('');
}
