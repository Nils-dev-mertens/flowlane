import type {
  AzureDevOpsProviderConfig,
  FlowlaneConfig,
  GitHubProviderConfig,
  JiraProviderConfig,
  ProviderBlocks,
  ProviderId,
  TicketProvider,
  VcsProvider,
} from '../types';
import { getProviderSpec } from './providerRegistry';

const TICKET_PROVIDER_IDS: ReadonlyArray<string> = ['azuredevops', 'jira', 'github'];
const VCS_PROVIDER_IDS: ReadonlyArray<string> = ['github', 'azuredevops'];

function isTicketProvider(value: unknown): value is TicketProvider {
  return typeof value === 'string' &&
    TICKET_PROVIDER_IDS.includes(value);
}

function isVcsProvider(value: unknown): value is VcsProvider {
  return typeof value === 'string' &&
    VCS_PROVIDER_IDS.includes(value);
}

/**
 * Resolve the ticket provider from explicit config, falling back to the legacy
 * `platform` alias. Returns undefined when neither is configured.
 */
export function resolveTicketProvider(
  config: Partial<FlowlaneConfig>,
): TicketProvider | undefined {
  const candidate = config.ticketProvider ?? config.platform;
  return isTicketProvider(candidate) ? candidate : undefined;
}

/**
 * Resolve the VCS/PR provider from explicit config, falling back to the legacy
 * `platform` alias. Jira is not a VCS provider (it does not host pull
 * requests), so a Jira platform never resolves to a VCS provider.
 */
export function resolveVcsProvider(
  config: Partial<FlowlaneConfig>,
): VcsProvider | undefined {
  const candidate = config.vcsProvider ?? config.platform;
  if (candidate === 'jira') return undefined;
  return isVcsProvider(candidate) ? candidate : undefined;
}

/**
 * Resolve a provider's effective config block by merging the nested provider
 * block over the legacy flat fields (mapped via the provider registry).
 *
 * Nested values win over legacy values; undefined entries are dropped.
 */
export function resolveProviderConfig<P extends ProviderId>(
  config: Partial<FlowlaneConfig>,
  provider: P,
): ProviderBlocks[P] {
  const spec = getProviderSpec(provider);
  const nested = (config[provider] ?? {}) as Record<string, unknown>;
  const legacy = spec.fromLegacy(config);

  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(legacy)) {
    if (value !== undefined && value !== '') merged[key] = value;
  }
  for (const [key, value] of Object.entries(nested)) {
    if (value !== undefined && value !== '') merged[key] = value;
  }

  return merged as unknown as ProviderBlocks[P];
}

/** Short human-readable descriptor for a resolved provider block. */
export function providerDescriptor(
  provider: ProviderId,
  block: Partial<ProviderBlocks[ProviderId]>,
): string {
  switch (provider) {
    case 'github': {
      const g = block as Partial<GitHubProviderConfig>;
      return g.owner && g.repo ? `${g.owner}/${g.repo}` : (g.owner ?? 'github');
    }
    case 'azuredevops': {
      const a = block as Partial<AzureDevOpsProviderConfig>;
      return a.org && a.project ? `${a.org}/${a.project}` : (a.org ?? 'azuredevops');
    }
    case 'jira': {
      const j = block as Partial<JiraProviderConfig>;
      return j.site && j.project ? `${j.site}/${j.project}` : (j.site ?? 'jira');
    }
  }
}
