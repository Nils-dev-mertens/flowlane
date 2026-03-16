import * as p from '@clack/prompts';
import chalk from 'chalk';
import { container } from '../container';
import { TOKENS } from '../tokens';
import { ConfigService } from '../config/ConfigService';
import { detectFromGit } from '../utils/gitDetect';
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

  const cfg      = container.resolve<ConfigService>(TOKENS.ConfigService);
  const detected = detectFromGit();

  if (detected.detected) {
    const fields: string[] = [];
    if (detected.platform) fields.push(`platform: ${detected.platform}`);
    if (detected.org)      fields.push(`org: ${detected.org}`);
    if (detected.project)  fields.push(`project: ${detected.project}`);
    if (detected.repo)     fields.push(`repo: ${detected.repo}`);
    if (detected.baseBranch) fields.push(`baseBranch: ${detected.baseBranch}`);
    if (detected.user)     fields.push(`user: ${detected.user}`);
    p.note(fields.join('\n'), 'Auto-detected from git remote');
  }

  // ── Profile name ──────────────────────────────────────────────────────────

  let profileName = nameArg?.trim() ?? '';
  if (!profileName) {
    const input = await p.text({
      message: 'Profile name:',
      placeholder: detected.org ?? 'work',
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
    initialValue: detected.platform ?? 'azuredevops',
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
    initialValue: detected.org ?? '',
    validate: (v) => v.trim() ? undefined : 'Required',
  }) as string;
  if (p.isCancel(org)) { p.cancel('Cancelled.'); return; }

  // ── Project ───────────────────────────────────────────────────────────────

  const project = await p.text({
    message: 'Default project name:',
    placeholder: 'MyProject',
    initialValue: detected.project ?? '',
    validate: (v) => v.trim() ? undefined : 'Required',
  }) as string;
  if (p.isCancel(project)) { p.cancel('Cancelled.'); return; }

  // ── Repo ──────────────────────────────────────────────────────────────────

  const repoInput = await p.text({
    message: 'Default repository name (leave blank to use project name):',
    placeholder: project.trim(),
    initialValue: detected.repo ?? '',
  }) as string;
  if (p.isCancel(repoInput)) { p.cancel('Cancelled.'); return; }
  const repo = repoInput?.trim() || project.trim();

  // ── Auth method ───────────────────────────────────────────────────────────

  let authMethod: 'pat' | 'az-cli' = 'pat';
  let token = '';

  if (platform === 'azuredevops') {
    const authChoice = await p.select({
      message: 'Authentication method:',
      initialValue: 'pat',
      options: [
        { value: 'pat',    label: 'Personal Access Token (PAT)', hint: 'token stored in config' },
        { value: 'az-cli', label: 'Azure CLI (az login)',        hint: 'no token stored — uses az account get-access-token' },
      ],
    }) as string;
    if (p.isCancel(authChoice)) { p.cancel('Cancelled.'); return; }
    authMethod = authChoice as 'pat' | 'az-cli';
  }

  if (authMethod === 'pat') {
    const tokenHint = platform === 'azuredevops'
      ? 'dev.azure.com → User Settings → Personal Access Tokens\nScopes: Work Items R+W, Code R+W, Pull Requests R+W'
      : 'id.atlassian.com → Manage profile → Security → API tokens';
    p.note(tokenHint, 'How to get a token');

    const pat = await p.password({
      message: 'API token / PAT:',
      validate: (v) => v.trim() ? undefined : 'Required',
    }) as string;
    if (p.isCancel(pat)) { p.cancel('Cancelled.'); return; }
    token = pat.trim();
  } else {
    p.note('Make sure you are signed in: az login', 'Azure CLI auth');
  }

  // ── User ──────────────────────────────────────────────────────────────────

  const user = await p.text({
    message: 'Your username / email (used to fetch assigned tickets):',
    placeholder: platform === 'azuredevops' ? 'jane@company.com' : 'jane@atlassian.net',
    initialValue: detected.user ?? '',
    validate: (v) => v.trim() ? undefined : 'Required',
  }) as string;
  if (p.isCancel(user)) { p.cancel('Cancelled.'); return; }

  // ── Base branch ───────────────────────────────────────────────────────────

  const baseBranch = await p.text({
    message: 'Default base branch for pull requests:',
    placeholder: 'main',
    initialValue: detected.baseBranch ?? 'main',
  }) as string;
  if (p.isCancel(baseBranch)) { p.cancel('Cancelled.'); return; }

  // ── Persist ───────────────────────────────────────────────────────────────

  const profileConfig: Partial<FlowlaneConfig> = {
    platform:   platform as FlowlaneConfig['platform'],
    authMethod: authMethod === 'az-cli' ? 'az-cli' : undefined,
    org:        org.trim(),
    project:    project.trim(),
    repo:       repo,
    ...(token ? { token } : {}),
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
  const detected = detectFromGit();

  if (profiles.length === 0) {
    p.cancel('No profiles found. Run `flowlane init` first.');
    return;
  }

  // Try to guess the best matching profile from the detected org
  const defaultProfile = detected.org
    ? (profiles.find((n) => cfg.getProfile(n)?.org === detected.org) ?? profiles[0])
    : profiles[0];

  const chosenProfile = await p.select({
    message: 'Which profile should this repo use?',
    initialValue: defaultProfile,
    options: profiles.map((name) => {
      const pr = cfg.getProfile(name)!;
      return { value: name, label: name, hint: `${pr.org ?? ''} · ${pr.project ?? ''}` };
    }),
  }) as string;
  if (p.isCancel(chosenProfile)) { p.cancel('Cancelled.'); return; }

  const profile = cfg.getProfile(chosenProfile)!;

  // Optional per-repo overrides — pre-fill with git-detected values when available
  const projectOverride = await p.text({
    message: 'Project name for this repo (leave blank to keep profile default):',
    placeholder: profile.project ?? '',
    initialValue: detected.project && detected.project !== profile.project ? detected.project : '',
  }) as string;
  if (p.isCancel(projectOverride)) { p.cancel('Cancelled.'); return; }

  const repoOverride = await p.text({
    message: 'Repository name for this repo (leave blank to keep profile default):',
    placeholder: profile.repo ?? profile.project ?? '',
    initialValue: detected.repo && detected.repo !== profile.repo ? detected.repo : '',
  }) as string;
  if (p.isCancel(repoOverride)) { p.cancel('Cancelled.'); return; }

  const userOverride = await p.text({
    message: 'User identity for this repo (leave blank to keep profile default):',
    placeholder: profile.user ?? '',
    initialValue: detected.user && detected.user !== profile.user ? detected.user : '',
  }) as string;
  if (p.isCancel(userOverride)) { p.cancel('Cancelled.'); return; }

  const baseBranchOverride = await p.text({
    message: 'Base branch for this repo (leave blank to keep profile default):',
    placeholder: profile.baseBranch ?? 'main',
    initialValue: detected.baseBranch && detected.baseBranch !== profile.baseBranch ? detected.baseBranch : '',
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
