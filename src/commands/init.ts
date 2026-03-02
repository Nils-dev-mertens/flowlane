import * as p from '@clack/prompts';
import chalk from 'chalk';
import { container } from '../container';
import { TOKENS } from '../tokens';
import { ConfigService } from '../config/ConfigService';
import { profileAddCommand, profileInitLocalCommand } from './profile';

export async function initCommand(): Promise<void> {
  p.intro(chalk.bgCyan.black('  flowlane init  ') + chalk.dim('  Setup wizard'));

  const cfg = container.resolve<ConfigService>(TOKENS.ConfigService);

  // ── If profiles already exist, offer a choice ─────────────────────────────

  if (cfg.exists()) {
    const action = await p.select({
      message: 'What would you like to do?',
      options: [
        { value: 'add',   label: 'Add a new profile',                hint: 'new org / platform / token' },
        { value: 'local', label: 'Set up this repo (.flowlane)',      hint: 'pick a profile + per-repo overrides' },
        { value: 'list',  label: 'List existing profiles',            hint: '' },
      ],
    }) as string;

    if (p.isCancel(action)) { p.cancel('Cancelled.'); return; }

    if (action === 'add')   { await profileAddCommand();        return; }
    if (action === 'local') { await profileInitLocalCommand();  return; }

    if (action === 'list') {
      const names  = cfg.listProfiles();
      const active = cfg.getActiveProfileName();
      p.note(
        names.map((n) => {
          const pr  = cfg.getProfile(n)!;
          const dot = n === active ? chalk.green('●') : chalk.dim('○');
          return `${dot} ${n === active ? chalk.green.bold(n) : n}  ${chalk.dim(`${pr.platform} · ${pr.org} · ${pr.project}`)}`;
        }).join('\n'),
        'Profiles',
      );
      p.outro(`Run ${chalk.cyan('flowlane init')} again to add or configure.`);
      return;
    }
  }

  // ── First-run: create the first profile ───────────────────────────────────

  p.note(
    `No config found. Let's create your first profile.\nGlobal config: ${chalk.yellow(cfg.configFilePath)}`,
    'Welcome',
  );

  await profileAddCommand('default');

  // After creating the first profile, offer to set up repo-local config
  if (cfg.exists()) {
    const setupLocal = await p.confirm({
      message: 'Set up a .flowlane file for the current repo as well?',
      initialValue: false,
    });
    if (!p.isCancel(setupLocal) && setupLocal) {
      await profileInitLocalCommand();
    }
  }

  p.outro(`${chalk.green('✓')} Ready! Run ${chalk.cyan('flowlane tickets')} to browse your board.`);
}
