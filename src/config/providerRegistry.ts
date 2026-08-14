import type { FlowlaneConfig, ProviderId } from '../types';

/** Whether a provider can act as a ticket provider, a VCS/PR provider, or both. */
export type ProviderKind = 'ticket' | 'vcs' | 'both';

export interface ProviderConfigField {
  key: string;
  label: string;
  hint?: string;
  placeholder?: string;
  secret?: boolean;
  required?: boolean;
  /** When set, the wizard renders a select with these options instead of text input. */
  options?: ReadonlyArray<{ value: string; label: string; hint?: string }>;
  /** Validate a raw string; return an error message or undefined when valid. */
  validate?: (value: string) => string | undefined;
}

/**
 * Declarative description of a provider.
 *
 * This is the single source of truth used by the setup wizard, `config set`,
 * and `ConfigService.validate()`. Adding a new provider (e.g. Linear) only
 * requires a new entry here plus a service class and a container case.
 */
export interface ProviderSpec {
  id: ProviderId;
  kind: ProviderKind;
  /** Human-readable name shown in the wizard and profile list. */
  label: string;
  /** Config fields in wizard order. */
  fields: ReadonlyArray<ProviderConfigField>;
  /** Map legacy flat config fields into this provider's block. */
  fromLegacy: (flat: Partial<FlowlaneConfig>) => Record<string, unknown>;
}

export const PROVIDER_SPECS: Record<ProviderId, ProviderSpec> = {
  github: {
    id: 'github',
    kind: 'both',
    label: 'GitHub',
    fields: [
      { key: 'owner', label: 'Owner (user or organization)', required: true, placeholder: 'my-username' },
      { key: 'repo',  label: 'Repository name',               required: true, placeholder: 'my-repo' },
      { key: 'user',  label: 'GitHub username/login (not your email)', required: true, placeholder: 'jane' },
      {
        key: 'token',
        label: 'Token (optional for public reads, required for writes)',
        secret: true,
        hint: 'github.com → Settings → Developer settings → Personal access tokens',
      },
      { key: 'baseBranch', label: 'Default base branch', placeholder: 'main' },
    ],
    fromLegacy: (flat) => ({
      owner:      flat.org,
      repo:       flat.repo ?? flat.project,
      token:      flat.token,
      user:       flat.user,
      baseBranch: flat.baseBranch,
      baseUrl:    flat.baseUrl,
      graphqlUrl: flat.githubGraphqlUrl,
    }),
  },

  azuredevops: {
    id: 'azuredevops',
    kind: 'both',
    label: 'Azure DevOps',
    fields: [
      { key: 'org',     label: 'Organization', required: true, placeholder: 'my-company' },
      { key: 'project', label: 'Project',       required: true, placeholder: 'MyProject' },
      { key: 'repo',    label: 'Repository (blank = project)' },
      { key: 'user',    label: 'Email (used to fetch assigned tickets)', required: true, placeholder: 'jane@company.com' },
      {
        key: 'authMethod',
        label: 'Authentication method',
        options: [
          { value: 'pat',    label: 'Personal Access Token (PAT)', hint: 'token stored in config' },
          { value: 'az-cli', label: 'Azure CLI (az login)',        hint: 'no token stored' },
        ],
      },
      {
        key: 'token',
        label: 'Personal Access Token',
        secret: true,
        hint: 'dev.azure.com → User Settings → Personal Access Tokens\nScopes: Work Items R+W, Code R+W, Pull Requests R+W',
      },
      { key: 'baseBranch', label: 'Default base branch', placeholder: 'main' },
    ],
    fromLegacy: (flat) => ({
      org:          flat.org,
      project:      flat.project,
      repo:         flat.repo,
      token:        flat.token,
      user:         flat.user,
      baseBranch:   flat.baseBranch,
      authMethod:   flat.authMethod,
      team:         flat.team,
      activeStatus: flat.activeStatus,
      activeColumn: flat.activeColumn,
      reviewStatus: flat.reviewStatus,
      reviewColumn: flat.reviewColumn,
      closedStates: flat.closedStates,
    }),
  },

  jira: {
    id: 'jira',
    kind: 'ticket',
    label: 'Jira',
    fields: [
      { key: 'site',    label: 'Site subdomain', required: true, placeholder: 'acme.atlassian.net' },
      { key: 'project', label: 'Project key',    required: true, placeholder: 'PRJ' },
      { key: 'user',    label: 'Account email',  required: true, placeholder: 'jane@company.com' },
      {
        key: 'token',
        label: 'API token',
        required: true,
        secret: true,
        hint: 'id.atlassian.com → Manage profile → Security → API tokens',
      },
    ],
    fromLegacy: (flat) => ({
      site:    flat.org,
      project: flat.project,
      token:   flat.token,
      user:    flat.user,
    }),
  },
};

/** Providers usable as a ticket/work-item backend. */
export const TICKET_PROVIDERS: ReadonlyArray<ProviderSpec> = Object.values(PROVIDER_SPECS)
  .filter((spec) => spec.kind !== 'vcs');

/** Providers usable as a VCS/pull-request backend. */
export const VCS_PROVIDERS: ReadonlyArray<ProviderSpec> = Object.values(PROVIDER_SPECS)
  .filter((spec) => spec.kind !== 'ticket');

/** Look up a provider spec by id. */
export function getProviderSpec(id: ProviderId): ProviderSpec {
  return PROVIDER_SPECS[id];
}

/** Required (non-secret) field names for a provider, used by validation. */
export function requiredFields(spec: ProviderSpec): string[] {
  return spec.fields.filter((f) => f.required && !f.secret).map((f) => f.key);
}

/** Find a single field definition by key. */
export function getProviderField(spec: ProviderSpec, key: string): ProviderConfigField | undefined {
  return spec.fields.find((f) => f.key === key);
}
