import * as p from '@clack/prompts';
import chalk from 'chalk';
import { container } from '../container';
import { TOKENS } from '../tokens';
import { ConfigService } from '../config/ConfigService';
import type { FlowlaneConfig } from '../types';

// ── profile list ──────────────────────────────────────────────────────────────

export function profileListCommand(): void {
  const cfg = container.resolve<ConfigService>(TOKENS.ConfigService);

  if (!cfg.exists()) {
    console.log(chalk.yellow('No profiles found. Run: flowlane init'));
    return;
  }

  const names   = cfg.listProfiles();
  const active  = cfg.getActiveProfileName();
  const local   = cfg.localConfigPath;

  console.log(chalk.bold('Profiles:'));
  for (const name of names) {
    const profile  = cfg.getProfile(name)!;
    const isActive = name === active;
    const marker   = isActive ? chalk.green('●') : chalk.dim('○');
    const label    = isActive ? chalk.green.bold(name) : name;
    console.log(`  ${marker} ${label}  ${chalk.dim(`${profile.platform ?? '?'} · ${profile.org ?? '?'} · ${profile.project ?? '?'}`)}`);
  }

  if (local) {
    const localCfg = cfg.getAll();
    console.log('');
    console.log(chalk.dim(`Local override: ${local}`));
    if ((localCfg as Record<string, unknown>)['profile']) {
      console.log(chalk.dim(`  profile → ${(localCfg as Record<string, unknown>)['profile']}`));
    }
  }
}

// ── profile use ───────────────────────────────────────────────────────────────

export function profileUseCommand(name: string): void {
  const cfg = container.resolve<ConfigService>(TOKENS.ConfigService);
  try {
    cfg.setActiveProfile(name);
    console.log(`${chalk.green('✓')} Active profile set to ${chalk.cyan(name)}`);
  } catch (err: unknown) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}

// ── profile remove ────────────────────────────────────────────────────────────

export function profileRemoveCommand(name: string): void {
  const cfg = container.resolve<ConfigService>(TOKENS.ConfigService);
  const removed = cfg.deleteProfile(name);
  if (removed) {
    console.log(`${chalk.green('✓')} Profile ${chalk.cyan(name)} removed.`);
  } else {
    console.log(chalk.yellow(`Profile "${name}" not found.`));
  }
}

// ── profile add ───────────────────────────────────────────────────────────────

export async function profileAddCommand(nameArg?: string): Promise<void> {
  p.intro(chalk.bgCyan.black('  flowlane profile add  '));

  const cfg = container.resolve<ConfigService>(TOKENS.ConfigService);

  // ── Profile name ──────────────────────────────────────────────────────────

  let profileName = nameArg?.trim() ?? '';
  if (!profileName) {
    const input = await p.text({
      message: 'Profile name:',
      placeholder: 'work',
      validate: (v) => {
        if (!v.trim()) return 'Required';
        if (!/^[\w-]+$/.test(v.trim())) return 'Use only letters, numbers, hyphens, underscores';
        return undefined;
      },
    }) as string;
    if (p.isCancel(input)) { p.cancel('Cancelled.'); return; }
    profileName = input.trim();
  }

  if (cfg.getProfile(profileName)) {
    const overwrite = await p.confirm({
      message: `Profile "${profileName}" already exists. Overwrite?`,
      initialValue: false,
    });
    if (p.isCancel(overwrite) || !overwrite) { p.cancel('Cancelled.'); return; }
  }

  // ── Platform ──────────────────────────────────────────────────────────────

  const platform = await p.select({
    message: 'Platform:',
    options: [
      { value: 'azuredevops', label: 'Azure DevOps', hint: 'dev.azure.com' },
      { value: 'jira',        label: 'Jira (stub)',  hint: 'atlassian.net' },
    ],
  }) as string;
  if (p.isCancel(platform)) { p.cancel('Cancelled.'); return; }

  // ── Org ───────────────────────────────────────────────────────────────────

  const org = await p.text({
    message: platform === 'azuredevops' ? 'Azure DevOps organization:' : 'Jira subdomain:',
    placeholder: 'my-company',
    validate: (v) => v.trim() ? undefined : 'Required',
  }) as string;
  if (p.isCancel(org)) { p.cancel('Cancelled.'); return; }

  // ── Project ───────────────────────────────────────────────────────────────

  const project = await p.text({
    message: 'Default project name:',
    placeholder: 'MyProject',
    validate: (v) => v.trim() ? undefined : 'Required',
  }) as string;
  if (p.isCancel(project)) { p.cancel('Cancelled.'); return; }

  // ── Repo ──────────────────────────────────────────────────────────────────

  const repoInput = await p.text({
    message: 'Default repository name (leave blank to use project name):',
    placeholder: project.trim(),
  }) as string;
  if (p.isCancel(repoInput)) { p.cancel('Cancelled.'); return; }
  const repo = repoInput?.trim() || project.trim();

  // ── Token ─────────────────────────────────────────────────────────────────

  const tokenHint = platform === 'azuredevops'
    ? 'dev.azure.com → User Settings → Personal Access Tokens\nScopes: Work Items R+W, Code R+W, Pull Requests R+W'
    : 'id.atlassian.com → Manage profile → Security → API tokens';
  p.note(tokenHint, 'How to get a token');

  const token = await p.password({
    message: 'API token / PAT:',
    validate: (v) => v.trim() ? undefined : 'Required',
  }) as string;
  if (p.isCancel(token)) { p.cancel('Cancelled.'); return; }

  // ── User ──────────────────────────────────────────────────────────────────

  const user = await p.text({
    message: 'Your username / email (used to fetch assigned tickets):',
    placeholder: platform === 'azuredevops' ? 'jane@company.com' : 'jane@atlassian.net',
    validate: (v) => v.trim() ? undefined : 'Required',
  }) as string;
  if (p.isCancel(user)) { p.cancel('Cancelled.'); return; }

  // ── Base branch ───────────────────────────────────────────────────────────

  const baseBranch = await p.text({
    message: 'Default base branch for pull requests:',
    placeholder: 'main',
    defaultValue: 'main',
  }) as string;
  if (p.isCancel(baseBranch)) { p.cancel('Cancelled.'); return; }

  // ── Persist ───────────────────────────────────────────────────────────────

  const profileConfig: Partial<FlowlaneConfig> = {
    platform:   platform as FlowlaneConfig['platform'],
    org:        org.trim(),
    project:    project.trim(),
    repo:       repo,
    token:      token.trim(),
    user:       user.trim(),
    baseBranch: (baseBranch || 'main').trim(),
  };

  cfg.saveProfile(profileName, profileConfig);

  p.note(
    Object.entries(profileConfig)
      .map(([k, v]) => `${chalk.dim(k.padEnd(12))} ${k === 'token' ? chalk.dim('***') : v}`)
      .join('\n'),
    `Profile "${profileName}" saved`,
  );

  p.outro(`${chalk.green('✓')} Run ${chalk.cyan(`flowlane profile use ${profileName}`)} to activate it.`);
}

// ── profile init-local ────────────────────────────────────────────────────────

/** Interactively create / update a .flowlane file in the current repo. */
export async function profileInitLocalCommand(): Promise<void> {
  p.intro(chalk.bgCyan.black('  flowlane profile local  ') + chalk.dim('  Repo override'));

  const cfg      = container.resolve<ConfigService>(TOKENS.ConfigService);
  const profiles = cfg.listProfiles();

  if (profiles.length === 0) {
    p.cancel('No profiles found. Run `flowlane init` first.');
    return;
  }

  const chosenProfile = await p.select({
    message: 'Which profile should this repo use?',
    options: profiles.map((name) => {
      const pr = cfg.getProfile(name)!;
      return { value: name, label: name, hint: `${pr.org ?? ''} · ${pr.project ?? ''}` };
    }),
  }) as string;
  if (p.isCancel(chosenProfile)) { p.cancel('Cancelled.'); return; }

  const profile = cfg.getProfile(chosenProfile)!;

  // Optional per-repo overrides
  const projectOverride = await p.text({
    message: 'Project name for this repo (leave blank to keep profile default):',
    placeholder: profile.project ?? '',
  }) as string;
  if (p.isCancel(projectOverride)) { p.cancel('Cancelled.'); return; }

  const repoOverride = await p.text({
    message: 'Repository name for this repo (leave blank to keep profile default):',
    placeholder: profile.repo ?? profile.project ?? '',
  }) as string;
  if (p.isCancel(repoOverride)) { p.cancel('Cancelled.'); return; }

  const userOverride = await p.text({
    message: 'User identity for this repo (leave blank to keep profile default):',
    placeholder: profile.user ?? '',
  }) as string;
  if (p.isCancel(userOverride)) { p.cancel('Cancelled.'); return; }

  const baseBranchOverride = await p.text({
    message: 'Base branch for this repo (leave blank to keep profile default):',
    placeholder: profile.baseBranch ?? 'main',
  }) as string;
  if (p.isCancel(baseBranchOverride)) { p.cancel('Cancelled.'); return; }

  type LocalCfg = { profile: string; project?: string; repo?: string; user?: string; baseBranch?: string };
  const localCfg: LocalCfg = { profile: chosenProfile };
  if (projectOverride?.trim())    localCfg.project    = projectOverride.trim();
  if (repoOverride?.trim())       localCfg.repo       = repoOverride.trim();
  if (userOverride?.trim())       localCfg.user       = userOverride.trim();
  if (baseBranchOverride?.trim()) localCfg.baseBranch = baseBranchOverride.trim();

  cfg.saveLocalConfig(process.cwd(), localCfg);

  p.note(
    JSON.stringify(localCfg, null, 2),
    `.flowlane written`,
  );

  p.outro(`${chalk.green('✓')} This repo will now use profile ${chalk.cyan(chosenProfile)}.`);
}
