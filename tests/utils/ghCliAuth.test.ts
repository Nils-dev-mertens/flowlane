import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveGithubToken } from '../../src/utils/ghCliAuth';
import { resolveProviderConfig } from '../../src/config/providers';

test('resolveGithubToken returns the stored PAT when authMethod is pat or unset', () => {
  assert.equal(resolveGithubToken('pat-123', undefined), 'pat-123');
  assert.equal(resolveGithubToken('pat-123', 'pat'), 'pat-123');
  assert.equal(resolveGithubToken(undefined, undefined), undefined);
});

test('resolveProviderConfig maps legacy authMethod into the github block', () => {
  const block = resolveProviderConfig(
    { platform: 'github', org: 'acme', repo: 'widgets', user: 'jane', authMethod: 'gh-cli' },
    'github',
  );
  assert.equal(block.owner, 'acme');
  assert.equal(block.repo, 'widgets');
  assert.equal(block.authMethod, 'gh-cli');
});