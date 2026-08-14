import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProviderConfig, resolveTicketProvider, resolveVcsProvider } from '../../src/config/providers';
import type { FlowlaneConfig } from '../../src/types';

test('resolveTicketProvider prefers ticketProvider over the platform alias', () => {
  const config: Partial<FlowlaneConfig> = {
    platform: 'github',
    ticketProvider: 'jira',
  };
  assert.equal(resolveTicketProvider(config), 'jira');
});

test('resolveTicketProvider falls back to the legacy platform value', () => {
  assert.equal(resolveTicketProvider({ platform: 'azuredevops' }), 'azuredevops');
  assert.equal(resolveTicketProvider({ platform: 'github' }), 'github');
  assert.equal(resolveTicketProvider({ platform: 'jira' }), 'jira');
});

test('resolveTicketProvider returns undefined when nothing is configured', () => {
  assert.equal(resolveTicketProvider({}), undefined);
});

test('resolveVcsProvider prefers vcsProvider over the platform alias', () => {
  const config: Partial<FlowlaneConfig> = {
    platform: 'jira',
    vcsProvider: 'github',
  };
  assert.equal(resolveVcsProvider(config), 'github');
});

test('resolveVcsProvider falls back to the legacy platform value', () => {
  assert.equal(resolveVcsProvider({ platform: 'github' }), 'github');
  assert.equal(resolveVcsProvider({ platform: 'azuredevops' }), 'azuredevops');
});

test('resolveVcsProvider rejects jira since it does not host pull requests', () => {
  assert.equal(resolveVcsProvider({ platform: 'jira' }), undefined);
  assert.equal(resolveVcsProvider({ vcsProvider: 'jira' as never }), undefined);
});

test('resolveProviderConfig maps legacy flat fields into the GitHub block', () => {
  const config: Partial<FlowlaneConfig> = {
    platform: 'github',
    org: 'acme',
    project: 'web',
    token: 'gh-token',
    user: 'janedoe',
    baseBranch: 'develop',
  };

  assert.deepEqual(resolveProviderConfig(config, 'github'), {
    owner: 'acme',
    repo: 'web',
    token: 'gh-token',
    user: 'janedoe',
    baseBranch: 'develop',
  });
});

test('resolveProviderConfig prefers the nested block over legacy fields', () => {
  const config: Partial<FlowlaneConfig> = {
    platform: 'github',
    org: 'legacy-org',
    repo: 'legacy-repo',
    github: { owner: 'nested-org', repo: 'nested-repo' },
  };

  const resolved = resolveProviderConfig(config, 'github');
  assert.equal(resolved.owner, 'nested-org');
  assert.equal(resolved.repo, 'nested-repo');
});

test('resolveProviderConfig maps legacy fields into the Azure DevOps block', () => {
  const config: Partial<FlowlaneConfig> = {
    platform: 'azuredevops',
    org: 'acme',
    project: 'MyProject',
    repo: 'MyRepo',
    token: 'pat',
    user: 'jane@acme.com',
    team: 'MyProject Team',
  };

  const resolved = resolveProviderConfig(config, 'azuredevops');
  assert.equal(resolved.org, 'acme');
  assert.equal(resolved.project, 'MyProject');
  assert.equal(resolved.repo, 'MyRepo');
  assert.equal(resolved.team, 'MyProject Team');
});

test('resolveProviderConfig maps legacy fields into the Jira block', () => {
  const config: Partial<FlowlaneConfig> = {
    platform: 'jira',
    org: 'acme.atlassian.net',
    project: 'PRJ',
    token: 'api-token',
    user: 'jane@acme.com',
  };

  assert.deepEqual(resolveProviderConfig(config, 'jira'), {
    site: 'acme.atlassian.net',
    project: 'PRJ',
    token: 'api-token',
    user: 'jane@acme.com',
  });
});

test('resolveProviderConfig keeps independent blocks for mixed providers', () => {
  const config: Partial<FlowlaneConfig> = {
    ticketProvider: 'jira',
    vcsProvider: 'github',
    jira: { site: 'acme.atlassian.net', project: 'PRJ', token: 'jira-token', user: 'jane@acme.com' },
    github: { owner: 'acme', repo: 'web', token: 'gh-token', user: 'janedoe' },
  };

  assert.deepEqual(resolveProviderConfig(config, 'jira'), {
    site: 'acme.atlassian.net',
    project: 'PRJ',
    token: 'jira-token',
    user: 'jane@acme.com',
  });
  assert.deepEqual(resolveProviderConfig(config, 'github'), {
    owner: 'acme',
    repo: 'web',
    token: 'gh-token',
    user: 'janedoe',
  });
});
