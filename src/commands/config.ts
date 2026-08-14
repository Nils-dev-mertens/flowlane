import chalk from 'chalk';
import { container } from '../container';
import { TOKENS } from '../tokens';
import type { IConfigService } from '../services/interfaces/IConfigService';
import type { FlowlaneConfig, ProviderId } from '../types';
import { ConfigService } from '../config/ConfigService';
import { PROVIDER_SPECS, getProviderField, getProviderSpec } from '../config/providerRegistry';

/** Legacy flat keys (still settable; auto-mapped into provider blocks). */
const FLAT_KEYS = new Set<keyof FlowlaneConfig>([
  'platform', 'ticketProvider', 'vcsProvider', 'authMethod', 'org', 'project', 'repo', 'token',
  'user', 'baseBranch', 'baseUrl', 'githubGraphqlUrl', 'team', 'activeStatus', 'activeColumn',
  'reviewStatus', 'reviewColumn', 'closedStates',
  'hookAfterBranch', 'hookAfterPR', 'hookAfterReview', 'hookAfterStart', 'hookAfterComment',
]);

/** Parse a dotted key like `github.owner` into { provider, field }. */
function parseProviderKey(key: string): { provider: ProviderId; field: string } | null {
  const dot = key.indexOf('.');
  if (dot <= 0 || dot === key.length - 1) return null;
  const provider = key.slice(0, dot);
  const field = key.slice(dot + 1);
  if (!(provider in PROVIDER_SPECS)) return null;
  return { provider: provider as ProviderId, field };
}

export function configSetCommand(key: string, value: string): void {
  const dotted = parseProviderKey(key);

  if (dotted) {
    const spec  = getProviderSpec(dotted.provider);
    if (!getProviderField(spec, dotted.field)) {
      console.error(chalk.red(`Unknown field "${dotted.field}" for ${dotted.provider}. Valid fields: ${spec.fields.map((f) => f.key).join(', ')}`));
      process.exit(1);
    }
  } else if (!FLAT_KEYS.has(key as keyof FlowlaneConfig)) {
    console.error(chalk.red(`Unknown config key: "${key}". Use a flat key (${[...FLAT_KEYS].join(', ')}) or a dotted provider key (e.g. github.owner, azuredevops.project).`));
    process.exit(1);
  }

  const cfg = container.resolve<IConfigService>(TOKENS.ConfigService);

  const write = dotted
    ? cfg.setProviderField(dotted.provider, dotted.field, value)
    : cfg.set(key as keyof FlowlaneConfig, value);

  write
    .then(() => {
      const displayVal = key === 'token' || key.endsWith('.token') ? chalk.dim('***') : value;
      console.log(`${chalk.green('✓')} Set ${chalk.cyan(key)} = ${displayVal}`);
    })
    .catch((err: unknown) => {
      console.error(chalk.red(`Failed to set config: ${errMsg(err)}`));
      process.exit(1);
    });
}

export function configGetCommand(key: string): void {
  const cfg = container.resolve<IConfigService>(TOKENS.ConfigService);

  const dotted = parseProviderKey(key);
  const value = dotted
    ? (cfg.getProviderConfig(dotted.provider) as unknown as Record<string, unknown>)[dotted.field]
    : cfg.get(key as keyof FlowlaneConfig);

  if (value === undefined || value === '') {
    console.log(chalk.yellow(`"${key}" is not set.`));
  } else if (key === 'token' || key.endsWith('.token')) {
    console.log(chalk.dim('***'));
  } else if (typeof value === 'object') {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(value);
  }
}

export function configListCommand(options: { json?: boolean } = {}): void {
  const cfg = container.resolve<ConfigService>(TOKENS.ConfigService);

  if (!cfg.exists()) {
    if (options.json) process.stdout.write(JSON.stringify({ error: 'No config found.' }) + '\n');
    else console.log(chalk.yellow('No config found. Run: flowlane init'));
    return;
  }

  const config = cfg.getAll();

  if (options.json) {
    process.stdout.write(JSON.stringify(maskSecrets(config), null, 2) + '\n');
    return;
  }

  const profileName = cfg.getActiveProfileName();
  const localPath   = cfg.localConfigPath;

  console.log(
    chalk.bold('Active config') +
    (profileName ? chalk.dim(` — profile: ${chalk.cyan(profileName)}`) : '') +
    (localPath   ? chalk.dim(` — local: ${localPath}`) : ''),
  );

  for (const [key, value] of Object.entries(config)) {
    const display = typeof value === 'object' && value !== null
      ? JSON.stringify(maskSecrets(value as Record<string, unknown>))
      : (key === 'token' ? chalk.dim('***') : String(value));
    console.log(`  ${chalk.cyan(key.padEnd(14))} ${display}`);
  }
}

/** Mask any `token` fields inside nested config blocks. */
function maskSecrets(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'token') out[key] = value ? '***' : undefined;
    else if (typeof value === 'object' && value !== null) out[key] = maskSecrets(value as Record<string, unknown>);
    else out[key] = value;
  }
  return out;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
