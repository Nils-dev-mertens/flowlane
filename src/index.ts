#!/usr/bin/env node
import 'reflect-metadata';
/**
 * flowlane — Agile board to pull request workflow automation.
 *
 * Ticket → Branch → PR
 */

import { Command } from 'commander';
import chalk from 'chalk';

import { setupContainer, container } from './container';
import { TOKENS }                    from './tokens';
import type { IConfigService }       from './services/interfaces/IConfigService';

// Bootstrap the DI container once, before any command runs.
setupContainer();

const program = new Command();

program
  .name('flowlane')
  .description('Agile board to PR workflow automation — Ticket → Branch → PR')
  .version('0.1.0');

// ── init ──────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Interactive setup wizard — configure flowlane for your project')
  .action(async () => {
    const { initCommand } = await import('./commands/init');
    await initCommand();
  });

// ── tickets ───────────────────────────────────────────────────────────────────

program
  .command('tickets')
  .description('Browse tickets assigned to you and take action (interactive TUI)')
  .option('--user <user>', 'Override the configured user identity')
  .action(async (opts: { user?: string }) => {
    await ensureConfig();
    const { ticketsCommand } = await import('./commands/tickets');
    await ticketsCommand(opts);
  });

// ── branch ────────────────────────────────────────────────────────────────────

program
  .command('branch <ticketId>')
  .description('Fetch a ticket, create a branch from its title, and push it')
  .action(async (ticketId: string) => {
    await ensureConfig();
    const { branchCommand } = await import('./commands/branch');
    try {
      await branchCommand(ticketId);
    } catch (err: unknown) {
      console.error(chalk.red(`Error: ${errMsg(err)}`));
      process.exit(1);
    }
  });

// ── pr ────────────────────────────────────────────────────────────────────────

program
  .command('pr <ticketId>')
  .description('Create a pull request and link the work item')
  .action(async (ticketId: string) => {
    await ensureConfig();
    const { prCommand } = await import('./commands/pr');
    try {
      await prCommand(ticketId);
    } catch (err: unknown) {
      console.error(chalk.red(`Error: ${errMsg(err)}`));
      process.exit(1);
    }
  });

// ── review ────────────────────────────────────────────────────────────────────

program
  .command('review <ticketId>')
  .description('Set a ticket status to "In Review"')
  .option('--status <status>', 'Custom status string to set', 'In Review')
  .action(async (ticketId: string, opts: { status: string }) => {
    await ensureConfig();
    const { reviewCommand } = await import('./commands/review');
    try {
      await reviewCommand(ticketId, { status: opts.status });
    } catch (err: unknown) {
      console.error(chalk.red(`Error: ${errMsg(err)}`));
      process.exit(1);
    }
  });

// ── start ─────────────────────────────────────────────────────────────────────

program
  .command('start <ticketId>')
  .description('Full workflow: branch → push → PR → set to In Review')
  .action(async (ticketId: string) => {
    await ensureConfig();
    const { startCommand } = await import('./commands/start');
    await startCommand(ticketId);
  });

// ── config ────────────────────────────────────────────────────────────────────

const configCmd = program
  .command('config')
  .description('Manage flowlane configuration');

configCmd
  .command('set <key> <value>')
  .description('Persist a config value (e.g. flowlane config set baseBranch develop)')
  .action((key: string, value: string) => {
    const { configSetCommand } = require('./commands/config') as typeof import('./commands/config');
    configSetCommand(key, value);
  });

configCmd
  .command('get <key>')
  .description('Print a single config value')
  .action((key: string) => {
    const { configGetCommand } = require('./commands/config') as typeof import('./commands/config');
    configGetCommand(key);
  });

configCmd
  .command('list')
  .description('List all config values')
  .action(() => {
    const { configListCommand } = require('./commands/config') as typeof import('./commands/config');
    configListCommand();
  });

// ── Default: no args → launch interactive ticket picker ───────────────────────

if (process.argv.length === 2) {
  // Rewrite argv so commander sees the 'tickets' command.
  process.argv.push('tickets');
}

program.parse(process.argv);

// ── helpers ───────────────────────────────────────────────────────────────────

async function ensureConfig(): Promise<void> {
  const cfg = container.resolve<IConfigService>(TOKENS.ConfigService);

  if (!cfg.exists()) {
    console.log(chalk.yellow('\nNo flowlane configuration found. Starting setup wizard…\n'));
    const { initCommand } = await import('./commands/init');
    await initCommand();
    console.log('');
  }

  const { valid, missing } = cfg.validate();
  if (!valid) {
    console.error(
      chalk.red(`\nInvalid config — missing: ${missing.join(', ')}\n`) +
      `Run ${chalk.cyan('flowlane init')} to fix your configuration.`,
    );
    process.exit(1);
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
