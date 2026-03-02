import * as p from '@clack/prompts';
import chalk from 'chalk';
import { container } from '../container';
import { TOKENS } from '../tokens';
import { ConfigService } from '../config/ConfigService';
import type { FlowlaneConfig } from '../types';

export async function initCommand(): Promise<void> {
  p.intro(chalk.bgCyan.black('  flowlane init  ') + chalk.dim('  Setup wizard'));

  const configService = container.resolve<ConfigService>(TOKENS.ConfigService);
  const configPath    = configService.configFilePath;

  if (configService.exists()) {
    const overwrite = await p.confirm({
      message: `Config already exists at ${chalk.yellow(configPath)}. Overwrite it?`,
      initialValue: false,
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.outro('Setup cancelled. Existing config preserved.');
      return;
    }
  }

  p.note(
    `This wizard creates your flowlane config file.\nPath: ${chalk.yellow(configPath)}`,
    'Welcome',
  );

  // ── Platform ──────────────────────────────────────────────────────────────

  const platform = await p.select({
    message: 'Select your agile platform:',
    options: [
      {
        value: 'azuredevops',
        label: 'Azure DevOps',
        hint: 'dev.azure.com — fully implemented',
      },
      {
        value: 'jira',
        label: 'Jira (stub)',
        hint: 'atlassian.net — contributions welcome',
      },
    ],
  }) as string;

  if (p.isCancel(platform)) { p.cancel('Setup cancelled.'); return; }

  // ── Org / subdomain ───────────────────────────────────────────────────────

  const orgLabel = platform === 'azuredevops'
    ? 'Azure DevOps organization name:'
    : 'Jira subdomain (e.g. mycompany):';

  const org = await p.text({
    message: orgLabel,
    placeholder: platform === 'azuredevops' ? 'my-company' : 'my-company',
    validate: (v) => v.trim() ? undefined : 'Required',
  }) as string;

  if (p.isCancel(org)) { p.cancel('Setup cancelled.'); return; }

  // ── Project ───────────────────────────────────────────────────────────────

  const project = await p.text({
    message: 'Project name:',
    placeholder: 'MyProject',
    validate: (v) => v.trim() ? undefined : 'Required',
  }) as string;

  if (p.isCancel(project)) { p.cancel('Setup cancelled.'); return; }

  // ── Repository (Azure DevOps only) ────────────────────────────────────────

  let repo: string | undefined;
  if (platform === 'azuredevops') {
    const repoInput = await p.text({
      message: 'Git repository name (leave blank to use project name):',
      placeholder: project,
    }) as string;
    if (p.isCancel(repoInput)) { p.cancel('Setup cancelled.'); return; }
    if(repoInput == undefined){
      repo == project;
    }
    else {repo = repoInput.trim() || project;}
  }

  // ── Token ─────────────────────────────────────────────────────────────────

  const tokenHint = platform === 'azuredevops'
    ? 'dev.azure.com → User Settings → Personal Access Tokens\nScopes needed: Work Items (Read & Write), Code (Read & Write), Pull Requests (Read & Write)'
    : 'id.atlassian.com → Manage profile → Security → API tokens';

  p.note(tokenHint, 'How to get a token');

  const token = await p.password({
    message: 'API token / Personal Access Token:',
    validate: (v) => v.trim() ? undefined : 'Required',
  }) as string;

  if (p.isCancel(token)) { p.cancel('Setup cancelled.'); return; }

  // ── User identity ─────────────────────────────────────────────────────────

  const userHint = platform === 'azuredevops'
    ? 'Your email or display name exactly as shown in Azure DevOps'
    : 'Your Jira account email address';

  const user = await p.text({
    message: 'Your username (used to fetch assigned tickets):',
    placeholder: userHint,
    validate: (v) => v.trim() ? undefined : 'Required',
  }) as string;

  if (p.isCancel(user)) { p.cancel('Setup cancelled.'); return; }

  // ── Base branch ───────────────────────────────────────────────────────────

  const baseBranch = await p.text({
    message: 'Base / target branch for pull requests:',
    placeholder: 'main',
    defaultValue: 'main',
  }) as string;

  if (p.isCancel(baseBranch)) { p.cancel('Setup cancelled.'); return; }

  // ── Persist ───────────────────────────────────────────────────────────────

  const spinner = p.spinner();
  spinner.start('Saving configuration…');

  const config: Partial<FlowlaneConfig> = {
    platform:   platform as FlowlaneConfig['platform'],
    org:        org.trim(),
    project:    project.trim(),
    token:      token.trim(),
    user:       user.trim(),
    baseBranch: (baseBranch || 'main').trim(),
  };
  if (repo) config.repo = repo.trim();

  for (const [key, value] of Object.entries(config)) {
    await configService.set(key as keyof FlowlaneConfig, String(value));
  }

  spinner.stop('Configuration saved.');

  p.note(
    Object.entries(config)
      .map(([k, v]) => `${chalk.dim(k.padEnd(12))} ${k === 'token' ? chalk.dim('***') : v}`)
      .join('\n'),
    'Saved',
  );

  p.outro(
    `${chalk.green('✓')} Setup complete! ` +
    `Run ${chalk.cyan('flowlane tickets')} to browse your board.`,
  );
}
