import * as p from '@clack/prompts';
import chalk from 'chalk';
import { container } from '../container';
import { TOKENS } from '../tokens';
import { ConfigService } from '../config/ConfigService';
import { detectFromGit } from '../utils/gitDetect';
import { fetchBoardColumns } from '../utils/azureBoard';
import { getAzCliToken } from '../utils/azCliAuth';
import { resolveProviderConfig, resolveTicketProvider, resolveVcsProvider, providerDescriptor } from '../config/providers';
import { TICKET_PROVIDERS, VCS_PROVIDERS, getProviderSpec } from '../config/providerRegistry';
import type { FlowlaneConfig, ProviderId, TicketProvider, VcsProvider } from '../types';

/** Human-readable descriptor for a profile's configured provider(s). */
export function profileDescriptor(profile: Partial<FlowlaneConfig>): string {
  const ticket = resolveTicketProvider(profile);
  const vcs    = resolveVcsProvider(profile);

  const parts: string[] = [];
  if (ticket) parts.push(providerDescriptor(ticket, resolveProviderConfig(profile, ticket)));
  if (vcs && vcs !== ticket) parts.push(providerDescriptor(vcs, resolveProviderConfig(profile, vcs)));
  return parts.join(' + ') || '?';
}

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
    console.log(`  ${marker} ${label}  ${chalk.dim(profileDescriptor(profile))}`);
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
    if (detected.user)     fields.push(`user: ${detected.user} (git email — not a GitHub login)`);
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

  // ── Ticket provider ───────────────────────────────────────────────────────

  const ticketProvider = await p.select({
    message: 'Ticket provider:',
    options: TICKET_PROVIDERS.map((spec) => ({ value: spec.id, label: spec.label })),
  }) as string;
  if (p.isCancel(ticketProvider)) { p.cancel('Cancelled.'); return; }

  // ── VCS / pull-request provider ───────────────────────────────────────────

  const vcsProvider = await p.select({
    message: 'Pull request (VCS) provider:',
    options: [
      { value: 'none', label: 'None', hint: 'tickets only — no pull requests' },
      ...VCS_PROVIDERS.map((spec) => ({ value: spec.id, label: spec.label })),
    ],
  }) as string;
  if (p.isCancel(vcsProvider)) { p.cancel('Cancelled.'); return; }

  // ── Ask each provider's config fields ─────────────────────────────────────

  const providerIds = new Set<ProviderId>([
    ticketProvider as TicketProvider,
    ...(vcsProvider !== 'none' ? [vcsProvider as VcsProvider] : []),
  ]);

  const blocks: Partial<FlowlaneConfig> = {};
  for (const providerId of providerIds) {
    const block = await askProviderFields(providerId, detected);
    if (!block) return; // cancelled
    (blocks as Record<string, unknown>)[providerId] = block;
  }

  // ── Azure DevOps board columns ────────────────────────────────────────────

  if (ticketProvider === 'azuredevops') {
    const adoBlock = blocks.azuredevops as Record<string, unknown> | undefined ?? {};
    const ok = await askAzureBoardConfig(
      adoBlock,
      (adoBlock.org as string) ?? '',
      (adoBlock.project as string) ?? '',
      ((adoBlock.authMethod as string | undefined) ?? 'pat') as 'pat' | 'az-cli',
      (adoBlock.token as string) ?? '',
    );
    if (!ok) return;
    (blocks as Record<string, unknown>).azuredevops = adoBlock;
  }

  // ── Persist ───────────────────────────────────────────────────────────────

  const profileConfig: Partial<FlowlaneConfig> = {
    ticketProvider: ticketProvider as TicketProvider,
    ...(vcsProvider !== 'none' ? { vcsProvider: vcsProvider as VcsProvider } : {}),
    ...blocks,
  };

  cfg.saveProfile(profileName, profileConfig);
  cfg.setActiveProfile(profileName);

  p.note(
    Object.entries(profileConfig)
      .map(([k, v]) => `${chalk.dim(k.padEnd(14))} ${formatValue(v)}`)
      .join('\n'),
    `Profile "${profileName}" saved & activated`,
  );

  // Offer to pin this profile to the current repo
  const pinLocal = await p.confirm({
    message: `Pin "${profileName}" as the default profile for this repo? (writes .flowlane)`,
    initialValue: true,
  });
  if (!p.isCancel(pinLocal) && pinLocal) {
    cfg.saveLocalConfig(process.cwd(), { profile: profileName });
    p.log.success(`${chalk.green('✓')} .flowlane written — this repo will always use "${profileName}".`);
  }

  p.outro(`${chalk.green('✓')} Profile "${profileName}" is now active.`);
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Ask all registry fields for one provider. Returns null when cancelled. */
async function askProviderFields(
  provider: ProviderId,
  detected: ReturnType<typeof detectFromGit>,
): Promise<Record<string, unknown> | null> {
  const spec    = getProviderSpec(provider);
  const initial = initialValues(provider, detected);
  const block: Record<string, unknown> = {};

  for (const field of spec.fields) {
    // Azure DevOps skips the token when Azure CLI authentication is selected.
    if (provider === 'azuredevops' && field.key === 'token' && block.authMethod === 'az-cli') {
      continue;
    }

    let value: unknown;

    if (field.options) {
      value = await p.select({
        message: field.label,
        options: [...field.options],
      });
    } else if (field.secret) {
      value = await p.password({
        message:  field.label,
        validate: (v) => (field.required && !v.trim() ? 'Required' : undefined),
      });
    } else {
      value = await p.text({
        message:      field.label,
        placeholder:  field.placeholder,
        initialValue: (initial[field.key] as string | undefined) ?? '',
        validate:     (v) => {
          if (!field.required) return undefined;
          return field.validate ? field.validate(v) : (v.trim() ? undefined : 'Required');
        },
      });
    }

    if (p.isCancel(value)) { p.cancel('Cancelled.'); return null; }

    const str = typeof value === 'string' ? value.trim() : String(value);
    if (str) block[field.key] = str;
  }

  return block;
}

/** Map git-detected values onto a provider's field keys. */
function initialValues(
  provider: ProviderId,
  detected: ReturnType<typeof detectFromGit>,
): Record<string, string | undefined> {
  const githubLogin = detected.user &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(detected.user)
    ? detected.user
    : '';

  switch (provider) {
    case 'github':
      return {
        owner:      detected.org,
        repo:       detected.repo ?? detected.project,
        user:       githubLogin,
        baseBranch: detected.baseBranch,
      };
    case 'azuredevops':
      return {
        org:        detected.org,
        project:    detected.project,
        repo:       detected.repo,
        user:       detected.user,
        baseBranch: detected.baseBranch,
      };
    case 'jira':
      return {
        site:    detected.org,
        project: detected.project,
        user:    detected.user,
      };
  }
}

/** Ask Azure DevOps board-column questions and populate the ado block. */
async function askAzureBoardConfig(
  block: Record<string, unknown>,
  org: string,
  project: string,
  authMethod: 'pat' | 'az-cli',
  token: string,
): Promise<boolean> {
  const defaultTeam = `${project.trim()} Team`;
  const teamInput = await p.text({
    message:     'Azure DevOps team name (used to read your board columns):',
    placeholder: defaultTeam,
    initialValue: '',
  }) as string;
  if (p.isCancel(teamInput)) { p.cancel('Cancelled.'); return false; }
  block.team = teamInput?.trim() || defaultTeam;

  // ── Fetch board columns ──────────────────────────────────────────────────

  const boardSpinner = p.spinner();
  boardSpinner.start(`Fetching board columns for "${block.team}"…`);

  let boardColumns: Awaited<ReturnType<typeof fetchBoardColumns>> | null = null;
  try {
    const tokenForBoard = authMethod === 'az-cli' ? getAzCliToken() : token;
    boardColumns = await fetchBoardColumns(org.trim(), project.trim(), tokenForBoard, String(block.team), authMethod);
    boardSpinner.stop(`Found ${boardColumns.length} board column(s).`);
  } catch (err: unknown) {
    boardSpinner.stop(chalk.yellow(`Could not fetch board: ${err instanceof Error ? err.message : String(err)}`));
    p.log.warn('Falling back to manual input. Update later with `flowlane config set`.');
  }

  if (boardColumns && boardColumns.length > 0) {
    const colStateMap = new Map(boardColumns.map((c) => [c.name, c.states]));

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
    if (p.isCancel(activePick)) { p.cancel('Cancelled.'); return false; }

    if (activePick) {
      block.activeColumn = activePick;
      block.activeStatus = (colStateMap.get(activePick) ?? [])[0] ?? '';
    }

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
    if (p.isCancel(reviewPick)) { p.cancel('Cancelled.'); return false; }

    if (reviewPick) {
      block.reviewColumn = reviewPick;
      block.reviewStatus = (colStateMap.get(reviewPick) ?? [])[0] ?? '';
    }

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
    if (p.isCancel(closedPick)) { p.cancel('Cancelled.'); return false; }

    const allClosedStates = closedPick
      .flatMap((colName) => colStateMap.get(colName) ?? [])
      .filter((v, i, arr) => arr.indexOf(v) === i);
    if (allClosedStates.length > 0) block.closedStates = allClosedStates.join(',');
  } else {
    const activeColumnInput = await p.text({
      message: 'Board column when you start work (leave blank to skip):',
      placeholder: 'Doing',
      initialValue: '',
    }) as string;
    if (p.isCancel(activeColumnInput)) { p.cancel('Cancelled.'); return false; }
    if (activeColumnInput?.trim()) {
      block.activeColumn = activeColumnInput.trim();
      const activeStateInput = await p.text({
        message: 'System.State for that column:',
        placeholder: 'Active',
        initialValue: '',
      }) as string;
      if (p.isCancel(activeStateInput)) { p.cancel('Cancelled.'); return false; }
      if (activeStateInput?.trim()) block.activeStatus = activeStateInput.trim();
    }

    const reviewColumnInput = await p.text({
      message: 'Board column when moving to review (leave blank to skip):',
      placeholder: 'Ready for Review',
      initialValue: '',
    }) as string;
    if (p.isCancel(reviewColumnInput)) { p.cancel('Cancelled.'); return false; }
    if (reviewColumnInput?.trim()) {
      block.reviewColumn = reviewColumnInput.trim();
      const reviewStateInput = await p.text({
        message: 'System.State for that column:',
        placeholder: 'Active',
        initialValue: '',
      }) as string;
      if (p.isCancel(reviewStateInput)) { p.cancel('Cancelled.'); return false; }
      if (reviewStateInput?.trim()) block.reviewStatus = reviewStateInput.trim();
    }

    const closedStatesInput = await p.text({
      message: 'Comma-separated closed/done states:',
      placeholder: 'Done,Removed,Closed,Resolved',
      initialValue: '',
    }) as string;
    if (p.isCancel(closedStatesInput)) { p.cancel('Cancelled.'); return false; }
    if (closedStatesInput?.trim()) block.closedStates = closedStatesInput.trim();
  }

  return true;
}

/** Format a config value for the saved-profile note (mask tokens). */
function formatValue(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value, (key, v) => (key === 'token' && v ? '***' : v));
  }
  return String(value);
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
      return { value: name, label: name, hint: profileDescriptor(pr) };
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
