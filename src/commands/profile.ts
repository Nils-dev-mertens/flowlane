import * as p from '@clack/prompts';
import chalk from 'chalk';
import { container } from '../container';
import { TOKENS } from '../tokens';
import { ConfigService } from '../config/ConfigService';
import { detectFromGit } from '../utils/gitDetect';
import { fetchBoardColumns } from '../utils/azureBoard';
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

  // ── Team name (Azure DevOps only) ─────────────────────────────────────────

  let teamValue = '';
  let activeStatusValue = '';  // System.State for "in progress"
  let activeColumnValue = '';  // System.BoardColumn for "in progress"
  let reviewStatusValue = '';  // System.State for "in review"
  let reviewColumnValue = '';  // System.BoardColumn for "in review"
  let closedStatesValue = '';

  if (platform === 'azuredevops') {
    const defaultTeam = `${project.trim()} Team`;
    const teamInput = await p.text({
      message: 'Azure DevOps team name (used to read your board columns):',
      placeholder: defaultTeam,
      initialValue: '',
    }) as string;
    if (p.isCancel(teamInput)) { p.cancel('Cancelled.'); return; }
    teamValue = teamInput?.trim() || defaultTeam;

    // ── Fetch board columns ──────────────────────────────────────────────────

    const boardSpinner = p.spinner();
    boardSpinner.start(`Fetching board columns for "${teamValue}"…`);

    let boardColumns: Awaited<ReturnType<typeof fetchBoardColumns>> | null = null;
    try {
      boardColumns = await fetchBoardColumns(org.trim(), project.trim(), token.trim(), teamValue);
      boardSpinner.stop(`Found ${boardColumns.length} board column(s).`);
    } catch (err: unknown) {
      boardSpinner.stop(chalk.yellow(`Could not fetch board: ${err instanceof Error ? err.message : String(err)}`));
      p.log.warn('Falling back to manual input. Update later with `flowlane config set`.');
    }

    if (boardColumns && boardColumns.length > 0) {
      // Build a map: column name → unique state values
      const colStateMap = new Map(boardColumns.map((c) => [c.name, c.states]));

      // ── Pick the "actively working on it" column ──────────────────────────

      const activePick = await p.select({
        message: 'Which column means you\'re actively working on a ticket?',
        options: [
          { value: '', label: 'Skip — don\'t change status when starting work', hint: '' },
          ...boardColumns.map((col) => ({
            value: col.name,
            label: col.name,
            hint:  col.states.length > 0 ? `state: ${col.states.join(', ')}` : '',
          })),
        ],
      }) as string;
      if (p.isCancel(activePick)) { p.cancel('Cancelled.'); return; }

      if (activePick) {
        const activeStates = colStateMap.get(activePick) ?? [];
        activeColumnValue = activePick;
        activeStatusValue = activeStates[0] ?? '';
      }

      // ── Pick the "in review" column ────────────────────────────────────────

      const reviewPick = await p.select({
        message: 'Which column means "ready for review"?',
        options: [
          { value: '', label: 'Skip — don\'t change status when moving to review', hint: '' },
          ...boardColumns.map((col) => ({
            value: col.name,
            label: col.name,
            hint:  col.states.length > 0 ? `state: ${col.states.join(', ')}` : '',
          })),
        ],
      }) as string;
      if (p.isCancel(reviewPick)) { p.cancel('Cancelled.'); return; }

      if (reviewPick) {
        // Store column name (System.BoardColumn) and its underlying state (System.State)
        const reviewStates = colStateMap.get(reviewPick) ?? [];
        reviewColumnValue = reviewPick;                // e.g. "Ready for Review"
        reviewStatusValue = reviewStates[0] ?? '';     // e.g. "Active"
      }

      // ── Pick the "done / closed" columns ──────────────────────────────────

      const closedPick = await p.multiselect({
        message: 'Which columns are "done / closed"? (multi-select, Space to toggle)',
        options: boardColumns.map((col) => ({
          value: col.name,
          label: col.name,
          hint:  col.states.length > 0 ? `state: ${col.states.join(', ')}` : '',
        })),
        initialValues: boardColumns.filter((c) => c.isOutgoing).map((c) => c.name),
        required: false,
      }) as string[];
      if (p.isCancel(closedPick)) { p.cancel('Cancelled.'); return; }

      // Flatten all selected column states into a deduplicated comma-separated list
      const allClosedStates = closedPick
        .flatMap((colName) => colStateMap.get(colName) ?? [])
        .filter((v, i, arr) => arr.indexOf(v) === i);
      closedStatesValue = allClosedStates.join(',');

    } else {
      // ── Fallback: manual text input ─────────────────────────────────────────

      const activeColumnInput = await p.text({
        message: 'Board column when you start work (leave blank to skip):',
        placeholder: 'Doing',
        initialValue: '',
      }) as string;
      if (p.isCancel(activeColumnInput)) { p.cancel('Cancelled.'); return; }
      activeColumnValue = activeColumnInput?.trim() ?? '';

      const activeStateInput = await p.text({
        message: activeColumnValue ? 'System.State for that column:' : '',
        placeholder: 'Active',
        initialValue: '',
      }) as string;
      if (activeColumnValue) {
        if (p.isCancel(activeStateInput)) { p.cancel('Cancelled.'); return; }
        activeStatusValue = activeStateInput?.trim() ?? '';
      }

      const reviewStatusInput = await p.text({
        message: 'Board column when moving to review (leave blank to skip):',
        placeholder: 'Ready for Review',
        initialValue: '',
      }) as string;
      if (p.isCancel(reviewStatusInput)) { p.cancel('Cancelled.'); return; }
      reviewColumnValue = reviewStatusInput?.trim() ?? '';

      const reviewStateInput = await p.text({
        message: reviewColumnValue ? 'System.State for that column:' : '',
        placeholder: 'Active',
        initialValue: '',
      }) as string;
      if (reviewColumnValue) {
        if (p.isCancel(reviewStateInput)) { p.cancel('Cancelled.'); return; }
        reviewStatusValue = reviewStateInput?.trim() ?? '';
      }

      const closedStatesInput = await p.text({
        message: 'Comma-separated closed/done states:',
        placeholder: 'Done,Removed,Closed,Resolved',
        initialValue: '',
      }) as string;
      if (p.isCancel(closedStatesInput)) { p.cancel('Cancelled.'); return; }
      closedStatesValue = closedStatesInput?.trim() ?? '';
    }
  }

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

  if (teamValue)          profileConfig.team          = teamValue;
  if (activeColumnValue)  profileConfig.activeColumn  = activeColumnValue;
  if (activeStatusValue)  profileConfig.activeStatus  = activeStatusValue;
  if (reviewColumnValue)  profileConfig.reviewColumn  = reviewColumnValue;
  if (reviewStatusValue)  profileConfig.reviewStatus  = reviewStatusValue;
  if (closedStatesValue)  profileConfig.closedStates  = closedStatesValue;

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
