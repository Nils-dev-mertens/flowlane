#!/usr/bin/env node
import 'reflect-metadata';
/**
 * flowlane — Agile board to pull request workflow automation.
 *
 * Ticket → Branch → PR
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'child_process';

import { setupContainer, container } from './container';
import { TOKENS }                    from './tokens';
import type { IConfigService }       from './services/interfaces/IConfigService';
import { ticketIdFromBranch }        from './utils/branch';

// Bootstrap the DI container once, before any command runs.
setupContainer();

const program = new Command();

program
  .name('flowlane')
  .description('Agile board to PR workflow automation — Ticket → Branch → PR')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  .version((require('../package.json') as { version: string }).version);

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
  .command('pr [ticketId]')
  .description('Create a pull request and link the work item (defaults to current branch ticket)')
  .action(async (ticketId?: string) => {
    await ensureConfig();
    const id = resolveTicketId(ticketId);
    if (!id) {
      const { ticketsCommand } = await import('./commands/tickets');
      await ticketsCommand({});
      return;
    }
    const { prCommand } = await import('./commands/pr');
    try {
      await prCommand(id);
    } catch (err: unknown) {
      console.error(chalk.red(`Error: ${errMsg(err)}`));
      process.exit(1);
    }
  });

// ── review ────────────────────────────────────────────────────────────────────

program
  .command('review [ticketId]')
  .description('Set a ticket status to "Ready for Review" (defaults to current branch ticket)')
  .option('--status <status>', 'Custom status string to set')
  .action(async (ticketId: string | undefined, opts: { status?: string }) => {
    await ensureConfig();
    const id = resolveTicketId(ticketId);
    if (!id) {
      const { ticketsCommand } = await import('./commands/tickets');
      await ticketsCommand({});
      return;
    }
    const { reviewCommand } = await import('./commands/review');
    try {
      await reviewCommand(id, { status: opts.status });
    } catch (err: unknown) {
      console.error(chalk.red(`Error: ${errMsg(err)}`));
      process.exit(1);
    }
  });

// ── describe ──────────────────────────────────────────────────────────────────

program
  .command('describe [ticketId]')
  .description('Show the full description of a ticket (defaults to current branch ticket)')
  .action(async (ticketId?: string) => {
    await ensureConfig();
    const id = resolveTicketId(ticketId);
    if (!id) {
      console.error(chalk.red('No ticket ID provided and could not detect one from the current branch.'));
      process.exit(1);
    }
    const { describeCommand } = await import('./commands/describe');
    try {
      await describeCommand(id);
    } catch (err: unknown) {
      console.error(chalk.red(`Error: ${errMsg(err)}`));
      process.exit(1);
    }
  });

// ── start ─────────────────────────────────────────────────────────────────────

program
  .command('start <ticketId>')
  .description('Full workflow: set ticket active → create branch → push')
  .action(async (ticketId: string) => {
    await ensureConfig();
    const { startCommand } = await import('./commands/start');
    await startCommand(ticketId);
  });

// ── profile ───────────────────────────────────────────────────────────────────

const profileCmd = program
  .command('profile')
  .description('Manage named profiles (credentials + project settings)');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    const { profileListCommand } = require('./commands/profile') as typeof import('./commands/profile');
    profileListCommand();
  });

profileCmd
  .command('use <name>')
  .description('Set the globally active profile')
  .action((name: string) => {
    const { profileUseCommand } = require('./commands/profile') as typeof import('./commands/profile');
    profileUseCommand(name);
  });

profileCmd
  .command('add [name]')
  .description('Add a new profile (interactive wizard)')
  .action(async (name?: string) => {
    const { profileAddCommand } = await import('./commands/profile');
    await profileAddCommand(name);
  });

profileCmd
  .command('remove <name>')
  .description('Delete a profile')
  .action((name: string) => {
    const { profileRemoveCommand } = require('./commands/profile') as typeof import('./commands/profile');
    profileRemoveCommand(name);
  });

profileCmd
  .command('local')
  .description('Create / update a .flowlane file in the current repo')
  .action(async () => {
    const { profileInitLocalCommand } = await import('./commands/profile');
    await profileInitLocalCommand();
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

/**
 * Resolves a ticket ID — uses the provided value if given, otherwise
 * attempts to parse it from the current git branch name.
 * Returns null if the branch doesn't contain a ticket ID (caller falls back to interactive flow).
 */
function resolveTicketId(ticketId?: string): string | null {
  if (ticketId) return ticketId;

  let branch: string;
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }

  const id = ticketIdFromBranch(branch);
  if (id) {
    console.log(chalk.dim(`Using ticket ${chalk.cyan(id)} from branch "${branch}"`));
  }
  return id;
}
